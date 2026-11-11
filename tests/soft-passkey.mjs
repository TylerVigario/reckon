/**
 * A passkey in software, for the checks: what a browser and an authenticator do
 * together, made from WebAuthn's own rules (https://www.w3.org/TR/webauthn-3/),
 * so a check can make a passkey and sign in with it as a phone would.
 *
 * It makes an ES256 key pair, answers a registration with "none" attestation,
 * and signs an assertion with the key. Its counter stays at 0, as a synced
 * passkey's does, so the checks can each sign in with one without having to
 * agree on a count between them. It says it checked
 * who is holding it (the UV flag) unless told not to, so a check can see a
 * passkey that did not refused. It says what origin it is on, so a check can
 * see a ceremony from another refused too.
 *
 * Nothing here is used by reckon itself.
 */
import {
	createHash,
	createPrivateKey,
	createSign,
	generateKeyPairSync,
	randomBytes
} from 'node:crypto';

const b64url = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString('base64url');
const fromB64url = (/** @type {string} */ s) => Buffer.from(s, 'base64url');
const sha256 = (/** @type {Uint8Array | string} */ b) => createHash('sha256').update(b).digest();

/**
 * The CBOR WebAuthn needs (RFC 8949): unsigned and negative ints, bytes, text, maps.
 *
 * @param {unknown} v
 * @returns {Buffer}
 */
function cbor(v) {
	/** @returns {Buffer} */
	const head = (/** @type {number} */ major, /** @type {number} */ n) => {
		if (n < 24) return Buffer.from([(major << 5) | n]);
		if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
		if (n < 0x10000) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
		const b = Buffer.alloc(5);
		b[0] = (major << 5) | 26;
		b.writeUInt32BE(n, 1);
		return b;
	};
	if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
	if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
	if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), v]);
	if (v instanceof Map)
		return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
	throw new Error(`no CBOR for ${typeof v}`);
}

// The authenticator data flags (WebAuthn §6.1).
const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

/**
 * A passkey as kept between runs: its credential id, its private key (PKCS #8,
 * base64), the site it is for and the user handle it answers with.
 *
 * @typedef {{ id: string, privateKey: string, rpId: string, userHandle: string }} KeptPasskey
 */

/**
 * A software authenticator holding the passkeys it makes, or was given.
 *
 * @param {{ origin: string, verifies?: boolean, keys?: KeptPasskey[] }} opts the
 *   origin it says it is on, whether it says it checked who is holding it, and
 *   passkeys it holds already
 */
export function softPasskeys({ origin, verifies = true, keys = [] }) {
	let checks = verifies;
	/** @type {Map<string, { key: import('node:crypto').KeyObject, rpId: string, userHandle: string }>} */
	const kept = new Map(
		keys.map((k) => [
			k.id,
			{
				key: createPrivateKey({
					key: Buffer.from(k.privateKey, 'base64'),
					format: 'der',
					type: 'pkcs8'
				}),
				rpId: k.rpId,
				userHandle: k.userHandle
			}
		])
	);
	const flags = (/** @type {number} */ extra) => UP | (checks ? UV : 0) | extra;

	return {
		/** How many it holds. */
		get size() {
			return kept.size;
		},

		/** Every passkey it holds, to keep for another run. @returns {KeptPasskey[]} */
		export() {
			return [...kept].map(([id, k]) => ({
				id,
				privateKey: k.key.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
				rpId: k.rpId,
				userHandle: k.userHandle
			}));
		},

		/** Whether it says it checked who is holding it, from now on. */
		set verifies(/** @type {boolean} */ v) {
			checks = v;
		},

		/**
		 * Answers the options a registration was begun with
		 * (PublicKeyCredentialCreationOptionsJSON), as a browser would send it.
		 *
		 * @param {{ challenge: string, rp: { id?: string }, user: { id: string } }} options
		 */
		create(options) {
			const rpId = options.rp.id ?? new URL(origin).hostname;
			const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
			const jwk = publicKey.export({ format: 'jwk' });
			const credentialId = randomBytes(16);
			const cose = cbor(
				new Map(
					/** @type {[number, number | Uint8Array][]} */ ([
						[1, 2],
						[3, -7],
						[-1, 1],
						[-2, fromB64url(/** @type {string} */ (jwk.x))],
						[-3, fromB64url(/** @type {string} */ (jwk.y))]
					])
				)
			);
			const length = Buffer.alloc(2);
			length.writeUInt16BE(credentialId.length);
			const authData = Buffer.concat([
				sha256(rpId),
				Buffer.from([flags(AT)]),
				Buffer.alloc(4),
				Buffer.alloc(16),
				length,
				credentialId,
				cose
			]);
			const clientData = JSON.stringify({
				type: 'webauthn.create',
				challenge: options.challenge,
				origin,
				crossOrigin: false
			});
			const attestation = cbor(
				new Map(
					/** @type {[string, string | Map<never, never> | Uint8Array][]} */ ([
						['fmt', 'none'],
						['attStmt', new Map()],
						['authData', authData]
					])
				)
			);
			kept.set(b64url(credentialId), { key: privateKey, rpId, userHandle: options.user.id });
			return {
				id: b64url(credentialId),
				rawId: b64url(credentialId),
				type: 'public-key',
				authenticatorAttachment: 'platform',
				clientExtensionResults: {},
				response: {
					clientDataJSON: b64url(Buffer.from(clientData)),
					attestationObject: b64url(attestation),
					transports: ['internal']
				}
			};
		},

		/**
		 * Answers the options a sign-in was begun with
		 * (PublicKeyCredentialRequestOptionsJSON) with the first passkey it holds
		 * for that site, or the one named.
		 *
		 * @param {{ challenge: string, rpId?: string }} options
		 * @param {string} [id]
		 */
		get(options, id) {
			const rpId = options.rpId ?? new URL(origin).hostname;
			const entry = id
				? [id, kept.get(id)]
				: ([...kept].find(([, k]) => k.rpId === rpId) ?? [undefined, undefined]);
			const [credentialId, k] = /** @type {[string, NonNullable<ReturnType<typeof kept.get>>]} */ (
				entry
			);
			if (!credentialId || !k) throw new Error(`no passkey here for ${rpId}`);
			const authData = Buffer.concat([sha256(rpId), Buffer.from([flags(0)]), Buffer.alloc(4)]);
			const clientData = Buffer.from(
				JSON.stringify({
					type: 'webauthn.get',
					challenge: options.challenge,
					origin,
					crossOrigin: false
				})
			);
			const signature = createSign('SHA256')
				.update(Buffer.concat([authData, sha256(clientData)]))
				.sign(k.key);
			return {
				id: credentialId,
				rawId: credentialId,
				type: 'public-key',
				authenticatorAttachment: 'platform',
				clientExtensionResults: {},
				response: {
					clientDataJSON: b64url(clientData),
					authenticatorData: b64url(authData),
					signature: b64url(signature),
					userHandle: k.userHandle
				}
			};
		}
	};
}
