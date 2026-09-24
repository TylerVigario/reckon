#!/usr/bin/env python3
"""Seed the .drawio schema diagrams from one definition of the tables.

WARNING: this OVERWRITES every .drawio file beside it. Once a box has been moved
or a note added in draw.io, the .drawio file is the source and this script is
not -- it exists to lay the tables out the first time.

Table definitions here mirror db/migrations/0001_the_schema.sql. Notes quote
docs/decisions.md, and anything that is my reading rather than Tyler's is
marked [claude].

Usage:  python3 regenerate.py
"""

import pathlib
import re
from xml.sax.saxutils import escape as _escape


def escape(s):
    """Attribute-safe: saxutils leaves quotes alone, and every note has them."""
    return _escape(s or "", {'"': '&quot;', "'": '&apos;'})

HERE = pathlib.Path(__file__).resolve().parent

W_KEY, W_NAME, W_TYPE = 34, 162, 140
W_TABLE = W_KEY + W_NAME + W_TYPE
H_HEAD, H_ROW = 26, 22

S_TABLE = ("shape=table;startSize={h};container=1;collapsible=1;childLayout=tableLayout;"
           "fixedRows=1;rowLines=0;fontStyle=1;align=center;resizeLast=1;html=1;"
           "fillColor=#ffffff;strokeColor=#2382b3;fontColor=#2e3a68;fontSize=13;")
S_ROW = ("shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;"
         "fillColor=none;collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];"
         "portConstraint=eastwest;top=0;left=0;right=0;bottom=0;strokeColor=#d4dae4;")
S_CELL = ("shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;"
          "right=0;overflow=hidden;whiteSpace=wrap;html=1;fontSize=11;"
          "align={align};spacingLeft={pad};fontColor={colour};{extra}")
S_EDGE = ("edgeStyle=entityRelationEdgeStyle;rounded=0;html=1;fontSize=10;"
          "startArrow=ERone;startFill=0;endArrow=ERmany;endFill=0;"
          "strokeColor=#4a5468;fontColor=#4a5468;exitX=1;exitY=0.5;exitDx=0;exitDy=0;"
          "entryX=0;entryY=0.5;entryDx=0;entryDy=0;")
S_EDGE_PLAIN = ("edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=10;"
                "endArrow=blockThin;endFill=1;strokeColor=#4a5468;fontColor=#4a5468;")
S_BOX = ("rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#4a5468;"
         "fontColor=#2e3a68;fontSize=13;verticalAlign=middle;")
S_BOX_HI = S_BOX.replace("strokeColor=#4a5468", "strokeColor=#2382b3;strokeWidth=2")
S_NOTE = ("text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=top;"
          "fontSize=11;fontColor=#7b8698;whiteSpace=wrap;")


def cell(cid, parent, value, style, x=0, y=0, w=0, h=0, alt=False):
    geo = f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry">'
    if alt:
        geo += f'<mxRectangle width="{w}" height="{h}" as="alternateBounds"/>'
    geo += "</mxGeometry>"
    return (f'        <mxCell id="{cid}" value="{escape(value)}" style="{style}" '
            f'vertex="1" parent="{parent}">{geo}</mxCell>')


def table(tid, name, cols, x, y):
    h = H_HEAD + H_ROW * len(cols)
    out = [cell(tid, "1", name, S_TABLE.format(h=H_HEAD), x, y, W_TABLE, h)]
    for i, (key, cname, ctype) in enumerate(cols):
        rid = f"{tid}-r{i}"
        out.append(cell(rid, tid, "", S_ROW, 0, H_HEAD + H_ROW * i, W_TABLE, H_ROW))
        bold = "fontStyle=1;" if key in ("PK", "UK") else ""
        colour = "#2382b3" if key else "#141a2b"
        out.append(cell(f"{rid}-k", rid, key,
                        S_CELL.format(align="center", pad=0, colour=colour, extra=bold),
                        0, 0, W_KEY, H_ROW, alt=True))
        out.append(cell(f"{rid}-n", rid, cname,
                        S_CELL.format(align="left", pad=6, colour="#141a2b", extra=bold),
                        W_KEY, 0, W_NAME, H_ROW, alt=True))
        out.append(cell(f"{rid}-t", rid, ctype,
                        S_CELL.format(align="left", pad=6, colour="#7b8698", extra=""),
                        W_KEY + W_NAME, 0, W_TYPE, H_ROW, alt=True))
    return out


def edge(eid, src, dst, label="", style=S_EDGE):
    return (f'        <mxCell id="{eid}" value="{escape(label)}" style="{style}" '
            f'edge="1" parent="1" source="{src}" target="{dst}">'
            f'<mxGeometry relative="1" as="geometry"/></mxCell>')


def box(bid, label, x, y, w, h, hi=False):
    return cell(bid, "1", label, S_BOX_HI if hi else S_BOX, x, y, w, h)


def note(nid, text, x, y, w, h=40):
    return cell(nid, "1", text, S_NOTE, x, y, w, h)


def refuse_overlaps(filename, cells, w, h):
    """A layout that prints text over text is not a diagram.

    Nothing caught these while the files were only ever opened in draw.io. They
    surfaced the first time a printable was built from them and press reported
    text on text -- seven collisions across six diagrams, and two canvases the
    content already ran past. The check belongs where the layout is decided.

    Rows and cells are skipped: they are meant to sit inside their table.
    """
    boxes = []
    for c in cells:
        if "shape=tableRow" in c or "partialRectangle" in c:
            continue
        m = re.search(r'<mxGeometry x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"', c)
        if m:
            boxes.append(tuple(int(g) for g in m.groups()))
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            (ax, ay, aw, ah), (bx, by, bw, bh) = boxes[i], boxes[j]
            if (min(ax + aw, bx + bw) - max(ax, bx) > 1
                    and min(ay + ah, by + bh) - max(ay, by) > 1):
                raise SystemExit(f"{filename}: two boxes overlap — "
                                 f"({ax},{ay},{aw},{ah}) and ({bx},{by},{bw},{bh})")
    for x, y, bw, bh in boxes:
        if x + bw > w or y + bh > h:
            raise SystemExit(f"{filename}: a box at ({x},{y},{bw},{bh}) "
                             f"runs past the {w}x{h} canvas")


def write(filename, title, cells, w=1600, h=1100):
    refuse_overlaps(filename, cells, w, h)
    body = "\n".join(cells)
    (HERE / filename).write_text(f'''<mxfile host="reckon" agent="regenerate.py" type="device">
  <diagram id="{filename.replace('.drawio','')}" name="{escape(title)}">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1"
        connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{w}"
        pageHeight="{h}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
{body}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
''')
    return filename


# --------------------------------------------------------------- the tables --

T = {}
T["entity"] = [("PK","id","uuid"),("UK","slug","text · in the URL"),("","name","text"),("","terms_days","int"),
    ("","payment_method","text"),("","opening_balance","numeric"),
    ("","tax_exempt","bool"),("","exemption_certificate","text"),
    ("","exemption_expires_on","date"),("","active","bool"),
    ("","created_at","timestamptz")]
T["site"] = [("PK","id","uuid"),("FK","entity_id","uuid · one client"),
    ("UK","slug","text · in the URL, per client"),
    ("","label","text · this client's name for it"),("","display","text · generated"),
    ("","street","text"),("","city","text"),("","region","text"),("","postcode","text"),
    ("","google_place_id","text"),("","address_verified_on","date"),
    ("","area_verified_on","date · last asked, NOT NULL"),
    ("","tax_area_code","text · CDTFA TAC, NOT NULL"),
    ("","tax_jurisdiction","text · CDTFA's name, NOT NULL"),
    ("","tax_rate_pct","numeric · CDTFA's rate, NOT NULL"),
    ("","state_rate_pct","numeric · the state's share"),
    ("","district_rate_pct","numeric · the districts on top"),
    ("","round_trip_miles","numeric"),("","drive_minutes","int"),("","active","bool"),
    ("","created_at","timestamptz")]
T["contact"] = [("PK","id","uuid"),("","name","text"),("","email","text"),
    ("","phone","text"),("","note","text")]
T["entity_contact"] = [("FK","entity_id","uuid"),("FK","contact_id","uuid"),
    ("","is_primary","bool")]
T["site_contact"] = [("FK","site_id","uuid"),("FK","entity_id","uuid · carried"),
    ("FK","contact_id","uuid"),("","is_primary","bool")]
T["site_tax_check"] = [("PK","id","uuid"),("FK","site_id","uuid"),
    ("","checked_at","timestamptz"),("","tax_area_code","text · CDTFA TAC"),
    ("","tax_jurisdiction","text"),("","rate_pct","numeric"),
    ("","state_rate_pct","numeric"),("","district_rate_pct","numeric"),
    ("","changed","bool"),("","note","text")]
T["tax_remittance"] = [("PK","id","uuid"),("","period_start","date"),
    ("","period_end","date"),("","filed_on","date"),("","paid_on","date"),
    ("","amount","numeric"),("","reference","text"),("FK","created_by","uuid"),
    ("","note","text"),("","created_at","timestamptz")]

T["integration"] = [("PK","name","stripe|beancount|press|email"),
    ("","connected","bool"),("","detail","text"),("","checked_at","timestamptz")]

T["service"] = [("PK","id","uuid"),("","code","text"),("","name","text"),
    ("","unit","hour | mile | each"),("","taxable","bool"),("","time_tracked","bool"),
    ("","bill_to_nearest_seconds","int · time only, null = exact"),
    ("","minimum_charge","numeric · null = none"),("","active","bool")]
T["service_price"] = [("PK","id","uuid"),("FK","service_id","uuid"),
    ("FK","entity_id","uuid · null = every client"),("","rate","numeric · the first person"),
    ("","additional_rate","numeric · each one after"),("","effective_from","date")]
T["pay_rule"] = [("PK","id","uuid"),("FK","service_id","uuid"),
    ("FK","role_id","uuid · a role, or"),("FK","user_id","uuid · one person"),
    ("FK","entity_id","uuid · null = every client"),("","pays_for","time|covered_time|vehicle"),
    ("","method","per_hour|percent|fixed|nothing"),("","amount","numeric · none for nothing"),
    ("","effective_from","date"),("","created_at","timestamptz")]
T["role"] = [("PK","id","uuid"),("UK","name","text · the operator's word"),
    ("","created_at","timestamptz")]
T["material"] = [("PK","id","uuid"),("","sku","text"),("","name","text"),
    ("","brand","text"),("","unit","each | foot"),("","markup_pct","numeric"),
    ("","taxable","bool"),("","reorder_level","numeric"),("","active","bool")]
T["material_lot"] = [("PK","id","uuid"),("FK","material_id","uuid"),
    ("","received_on","date"),("","supplier","text"),("","document_ref","text"),
    ("","qty_received","numeric"),("","qty_remaining","numeric"),
    ("","ex_tax_cost_per_unit","numeric"),("","tax_paid_per_unit","numeric")]
T["material_price"] = [("PK","id","uuid"),("FK","material_id","uuid"),
    ("","price","numeric"),("","effective_from","date")]

T["time_entry"] = [("PK","id","uuid"),("UK","client_uuid","uuid · from the phone"),
    ("","worked_on","date"),("","minutes","int"),
    ("","crew","one | team"),
    ("FK","worked_by","uuid · null when team"),("FK","created_by","uuid · ran the timer"),
    ("FK","entity_id","uuid · null = internal"),
    ("FK","site_id","uuid"),("FK","service_id","uuid"),("","billable","bool"),
    ("","note","text"),("","created_at","timestamptz")]
T["trip"] = [("PK","id","uuid"),("","travelled_on","date"),("FK","driven_by","uuid"),
    ("FK","created_by","uuid"),("","created_at","timestamptz")]
T["trip_stop"] = [("PK","id","uuid"),("FK","trip_id","uuid"),("","seq","int"),
    ("FK","site_id","uuid"),("","arrived_at","timestamptz"),
    ("","departed_at","timestamptz"),("","address","text · somewhere that is nobody's site")]
T["trip_leg"] = [("PK","id","uuid"),("FK","trip_id","uuid"),("","seq","int"),
    ("","miles","numeric"),("FK","entity_id","uuid · who caused it"),
    ("FK","site_id","uuid"),("FK","service_id","uuid · what it bills as"),("","rule","text")]

T["agreement"] = [("","billing_interval","weekly|monthly|quarterly|annually"),
    ("","billing_anchor_day","1–31 · from starts_on"),
    ("","final_period_proration","none|daily"),("FK","contact_id","uuid · agreed with"),("PK","id","uuid"),("FK","entity_id","uuid"),
    ("","basis","flat | per_location"),("","price","numeric"),("","starts_on","date"),
    ("","ends_on","date")]
T["agreement_service"] = [("PK","id","uuid"),("FK","agreement_id","uuid"),
    ("FK","service_id","uuid · once per agreement"),("","allotment","capped | unlimited"),
    ("","included_hours","numeric · capped only"),
    ("","allotment_basis","flat | per_location"),
    ("","overage","bill|no_charge|deny · capped only")]
T["agreement_site"] = [("FK","agreement_id","uuid"),("FK","site_id","uuid")]
T["agreement_period"] = [("PK","id","uuid"),("FK","agreement_id","uuid"),
    ("","period_start","date"),("","period_end","date"),
    ("","amount","numeric · as charged"),("","given","bool · charged nothing, on purpose")]

T["invoice"] = [("PK","id","uuid"),("UK","number","text"),("FK","entity_id","uuid"),
    ("","status","draft|sent|paid|void"),("","issued_on","date"),("","due_on","date"),
    ("","period_start","date"),("","period_end","date"),("UK","public_token","text"),
    ("","token_expires_on","date"),("","sent_at","timestamptz"),
    ("FK","created_by","uuid"),("","void_reason","text"),("","created_at","timestamptz")]
T["invoice_line"] = [("PK","id","uuid"),("FK","invoice_id","uuid"),("","seq","int"),
    ("","kind","service|material|recurring"),("","description","text"),
    ("","qty","numeric"),("","unit","hour|mile|each|foot|month"),
    ("","unit_price","numeric · as billed"),
    ("FK","site_id","uuid"),("","taxable","bool"),
    ("","tax_rate_pct","numeric · as applied"),("","tax_source","site|override|exempt"),
    ("","tax_override_reason","text"),("","ex_tax_cost","numeric · snapshot"),
    ("","tax_paid","numeric · snapshot"),("","amount","numeric"),
    ("FK","time_entry_id","uuid"),("FK","trip_leg_id","uuid"),
    ("FK","agreement_period_id","uuid"),("FK","material_lot_id","uuid")]
T["credit_note"] = [("PK","id","uuid"),("UK","number","text"),("FK","entity_id","uuid"),
    ("","issued_on","date"),("","amount","numeric"),
    ("","kind","reg1700b|correction"),("","reason","text"),
    ("FK","created_by","uuid"),("","created_at","timestamptz")]
T["credit_application"] = [("PK","id","uuid"),("FK","credit_note_id","uuid"),("FK","invoice_id","uuid"),
    ("","amount","numeric"),("","applied_on","date")]

T["payment"] = [("PK","id","uuid"),("FK","entity_id","uuid"),("","received_on","date"),
    ("","gross","numeric"),("","method","card|transfer|cheque"),
    ("","processor_ref","text"),("FK","payout_id","uuid · null until it lands"),("","created_at","timestamptz")]
T["payment_allocation"] = [("PK","id","uuid"),("FK","payment_id","uuid"),("FK","invoice_id","uuid"),
    ("","amount","numeric")]
T["refund"] = [("PK","id","uuid"),("FK","payment_id","uuid"),("","amount","numeric"),
    ("","refunded_on","date"),("","reason","text")]
T["payout"] = [("PK","id","uuid"),("","processor","text"),("","arrived_on","date"),
    ("","gross","numeric"),("","fees","numeric"),("","net","numeric"),
    ("","bank_reference","text")]

T["integration"] = [("PK","name","stripe|beancount|press|email"),
    ("","connected","bool"),("","detail","text · never a key"),
    ("","checked_at","timestamptz")]
T["operator"] = [("PK","id","uuid"),("","singleton","bool · one row only"),("","trading_name","text"),("","short_name","text"),
    ("","logo","bytea · null → name"),("","logo_media_type","text"),("","accent_colour","text"),("","address","text"),
    ("","google_place_id","text · the place it is"),
    ("","address_verified_on","date"),
    ("","tax_number","text"),("","tax_number_label","EIN | VAT | ABN"),
    ("","email","text"),("","phone","text"),
    ("","currency","text"),("","timezone","text"),("","rounding_mode","text"),
    ("","tax_rule_set","us_ca|flat_per_site|none"),("","invoice_number_format","text"),
    ("","next_invoice_number","int"),
    ("","default_terms_days","int"),("","ageing_alert_days","int"),
    ("","default_markup_pct","numeric · 20"),
    ("","invoice_footer","text"),("","auto_send","bool"),
    ("","email_attaches_pdf","bool"),("","email_includes_payment_link","bool"),
    ("","tax_registration","text"),("","tax_agency","text"),
    ("","filing_basis","annual|quarterly|monthly"),
    ("","fiscal_year_end_month","1–12"),
    ("","claims_tax_paid_purchases_resold","bool"),
    ("","date_format","text"),
    ("","mileage_assignment","actual|round_trip_per_client")]
T["app_user"] = [("PK","id","uuid"),("","name","text"),("UK","email","text"),
    ("","credential","text · argon2id"),("","active","bool"),
    ("FK","role_id","uuid · null = not paid"),("","failed_attempts","int"),
    ("","locked_until","timestamptz"),("","last_seen_at","timestamptz"),
    ("","created_at","timestamptz")]
T["session"] = [("PK","token_hash","text · sha256"),("FK","user_id","uuid"),
    ("","created_at","timestamptz"),("","expires_at","timestamptz"),
    ("","last_used","timestamptz"),("","user_agent","text")]
T["migration"] = [("PK","filename","text"),("","applied_at","timestamptz")]
T["record_history"] = [("PK","id","uuid"),("","table_name","text"),("","row_id","uuid"),
    ("","field","text"),("","old_value","text"),("","new_value","text"),
    ("FK","changed_by","uuid"),("","changed_at","timestamptz")]
T["account_map"] = [("PK","role","text · what it is for"),("","account","text · as the ledger names it")]
T["ledger_export"] = [("PK","id","uuid"),("","event","text"),("","source_table","text"),
    ("","source_id","uuid"),("","dated_on","date"),("","exported_at","timestamptz"),
    ("","transaction_text","text")]


def at(name, x, y):
    return table(name, name, T[name], x, y)


files = []

# 01 -- the shape
c  = [box("b_time", "time_entry\nworked_by · created_by", 40, 60, 220, 60)]
c += [box("b_trip", "trip → trip_leg\nmiles, assigned by cause", 40, 150, 220, 60)]
c += [box("b_agr",  "agreement_period\nmaterialised when generated", 40, 240, 220, 60)]
c += [box("b_lot",  "material_lot\nex-tax cost, tax paid", 40, 330, 220, 60)]
c += [box("b_inv",  "invoice\nimmutable once sent", 400, 60, 240, 60)]
c += [box("b_line", "invoice_line\nprice as billed · rate as applied\none source", 400, 170, 240, 100, hi=True)]
c += [box("b_cn",   "credit_note\nhow a sent invoice is corrected", 400, 320, 240, 60)]
c += [box("b_pay",  "payment\nallocated, may be partial", 780, 60, 220, 60)]
c += [box("b_pout", "payout\none deposit, many payments", 780, 150, 220, 60)]
c += [box("b_led",  "ledger_export\nbeancount, one way", 780, 240, 220, 60)]
c += [box("b_base", "operator · app_user · record_history", 40, 430, 960, 44)]
for i, src in enumerate(("b_time","b_trip","b_agr","b_lot")):
    c += [edge(f"e1{i}", src, "b_line", "becomes a line" if i == 0 else "", S_EDGE_PLAIN)]
c += [edge("e14","b_line","b_inv","belongs to",S_EDGE_PLAIN),
      edge("e15","b_line","b_cn","corrected by",S_EDGE_PLAIN),
      edge("e16","b_inv","b_pay","settles",S_EDGE_PLAIN),
      edge("e17","b_pay","b_pout","batched into",S_EDGE_PLAIN),
      edge("e18","b_line","b_led","posts",S_EDGE_PLAIN)]
c += [note("n1", "[claude] Nothing flows backwards. A sent invoice never reaches back "
                 "and changes the time entry that fed it; the only arrow the other way "
                 "is credit_note.", 40, 490, 960)]
files.append(write("01-overview.drawio", "Overview", c, 1100, 580))

# 02 -- who and where
c = at("entity",40,60) + at("site",800,60) \
  + at("contact",800,580) + at("entity_contact",440,240) \
  + at("site_contact",440,460) \
  + at("site_tax_check",1200,60) + at("tax_remittance",1200,340)
c += [edge("e22","entity","entity_contact","is reached via"),
      edge("e23","contact","entity_contact","acts for",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=1")),
      edge("e26","entity_contact","site_contact","is named at"),
      edge("e27","site","site_contact","asks for",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=1")),
      edge("e24","site","site_tax_check","was priced by CDTFA")]
c += [note("n2", "\"wild jacks is completely seperate. only shared infra\" — 18 Aug. One "
                 "building can host two businesses and one person can act for several "
                 "clients, so both joins are many-to-many.\n\n"
                 "\"tax screen shouldnt be a thing. it should just be rates pulled in per "
                 "site via api, regularly updated as to not fall behind. there is no rate "
                 "that is app managed anymore\" — 20 Sep. There is no pool of levies and no "
                 "screen to curate one: a site carries the rate CDTFA\u2019s API returned "
                 "for its address, their name for the area and their TAC, and the day it "
                 "was asked. site_tax_check keeps every answer, so a rate that moved can be "
                 "explained against the invoices billed at the old one. A second copy of a "
                 "published rate is a rate that goes stale without telling anyone, which is "
                 "how every address ended up at the operator\u2019s own 7.975%.\n\n"
                 "\"there has to be a way to programmatically figure out the state wide rate. "
                 "this application connects to beancount thus needs a way to track tax "
                 "obligations\" — 20 Sep. CDTFA\u2019s published rate layer carries "
                 "StateRate, CountyRate and CityRate beside the total, keyed by the same "
                 "TAC the rate API returns \u2014 StateRate has ONE distinct value across "
                 "all 558 Californian jurisdictions, so the statewide rate is read rather "
                 "than assumed, and State+County+City = RATE on every record. That split "
                 "is what lets tax collected post to the right obligation: it is not "
                 "income, it is somebody else\u2019s money held briefly. tax_remittance "
                 "records what was actually handed over, because no invoice knows that. "
                 "County and city fold into one district share \u2014 \"the rate should be "
                 "listed as state + district\" \u2014 because CDTFA-105 is a list of "
                 "districts and names no other kind.\n\n"
                 "\"All sites should have API retrieved rates, there should never be a "
                 "situation in which they have not\" — 20 Sep. So the address and the "
                 "answer are NOT NULL together: the API wants street, city AND zip and "
                 "refuses without all three, and a place that cannot be priced cannot be "
                 "billed from — which makes it not a site. Creating one is a lookup, not a "
                 "form that can be half-filled.\n\n"
                 "\"each site should be able to have its own contact or be null to fall "
                 "back on the client contact\" \u2014 9 Sep, and \"contact should be per "
                 "client and per site\" \u2014 14 Sep. A person is shared: one contact acts "
                 "for several clients, which is why contact has no owner. What is per "
                 "client is entity_contact, and what is per site is site_contact \u2014 "
                 "several people at a site, one of them answering first, and a site naming "
                 "nobody falling back to the client\u2019s primary. site_contact carries "
                 "the client so two foreign keys can agree: the site is that client\u2019s "
                 "and the person is that client\u2019s contact.\n\n"
                 "\"Bravo Farms is a client, and the sites are Traver, Kettleman, etc\" "
                 "\u2014 9 Sep. A site belongs to exactly one client; two clients at one "
                 "address are two sites.",
           40, 720, 1480, 280)]
files.append(write("02-who-and-where.drawio", "Who and where", c, 1560, 1040))

# 03 -- catalogue
c = at("service",40,60) + at("service_price",440,60) + at("pay_rule",440,280) \
  + at("role",840,400) \
  + at("material",840,60) + at("material_lot",1240,60) + at("material_price",1240,320)
c += [edge("e30","service","service_price","priced by"),
      edge("e31","service","pay_rule","pays by"),
      edge("e34","role","pay_rule","is paid by",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=1")),
      edge("e32","material","material_lot","received as"),
      edge("e33","material","material_price","may pin")]
c += [note("n3", "\"the services should be universal in nature but allow for our "
                 "specific requirements, not set in stone\" — 23 Sep. A service is "
                 "configured, not categorised: what it is charged per, how finely, at "
                 "least what, and whom it pays.\n\n"
                 "On site: $80.00 one person, $130.00 both — 2 Sep. A price counts heads: "
                 "rate is the first person and additional_rate each one after, so $80 and "
                 "+$50 is the $130. Nothing extra per head prices the job; the two equal "
                 "prices the person.\n\n"
                 "\"gauranteed payments only work for people who have actually worked. "
                 "that would mean a service is configured per user and per user level "
                 "(partner, employee, etc) and payouts happens at a unit measurement (per "
                 "hour but granular down to the minute/second) but also could be a "
                 "percentage payout of the entire charge\" — 23 Sep. pay_rule is that: "
                 "a role or one person, for their time or their vehicle, per hour, a "
                 "percentage of the line, a fixed amount, or nothing. The narrowest rule "
                 "that has started pays: one client's before every client's, one "
                 "person's before their role's.\n\n"
                 "\"personal mileage is 100% but company mileage would be 0% payout "
                 "regardless who drove\" — 23 Sep. A vehicle rule pays whoever owns the "
                 "vehicle, so a company vehicle pays nobody.\n\n"
                 "\"retainer covered hours should be percentage based payouts (can be "
                 "more than one responder each month and that too should be percentage) "
                 "and bravo would effectively be 0% payout to responder\" — 23 Sep. A "
                 "covered_time rule is a percentage of what the retainer charged for the "
                 "period, split by each person's share of its covered hours.\n\n"
                 "\"yes each can be a service charge, thats what allows flat rates as "
                 "you pointed out per service item\" — 23 Sep. unit each charges per "
                 "entry, whatever its length.\n\n"
                 "\"the interim solution should be a time-based toggle per service item "
                 "that causes it to show/hide from the time service drop down\" — 9 Sep. "
                 "unit is how it is charged; time_tracked is whether time is captured "
                 "against it. Mileage may be timed and still billed per mile.\n\n"
                 "\"allotment for a service shouldnt even a part of its service "
                 "configuration. that should be per client and/or per site\" — 24 Sep. "
                 "A service has no allotment of its own; what a client gets included "
                 "is on their agreement, service by service.\n\n"
                 "[claude] bill_to_nearest_seconds and minimum_charge were proposed, not "
                 "asked for: the usual next question about an hourly price. Pay is never "
                 "rounded to them; it is counted as worked.\n\n"
                 "[claude] material_lot is where stock enters, and where the Reg 1701 "
                 "ex-tax purchase price is sourced. Weighted-average cost needs lots to "
                 "average.", 40, 580, 1540, 330)]
files.append(write("03-catalogue.drawio", "What you sell", c, 1620, 950))

# 04 -- work captured
c = at("time_entry",40,60) + at("trip",480,60) + at("trip_stop",480,220) \
  + at("trip_leg",880,60) + at("app_user",40,420) + at("entity",880,300)
c += [edge("e40","app_user","time_entry","worked / created",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1")),
      edge("e41","trip","trip_stop","visits",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0")),
      edge("e42","trip","trip_leg","is made of"),
      edge("e43","entity","trip_leg","caused",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1"))]
c += [note("n4", "\"there is only he creates or i do\" — 3 Sep. worked_by is paid for "
                 "the hour and sets whether it bills at $80 or $130; created_by is how "
                 "the row is explained later.\n\n"
                 "\"he is a full partner after all and can have his own clients and very "
                 "much so is responsible for tracking his own time worked\" — 18 Aug.\n\n"
                 "[claude] client_uuid is made on the phone: the offline queue retries, "
                 "and without it a retry that timed out enters the hour twice.\n\n"
                 "\"wouldnt it just be simpler to log hours as both which get split at "
                 "partner pay out time?\" — 9 Sep. A team job is ONE entry carrying "
                 "crew = team, so the billable quantity is stored rather than derived. If "
                 "one stays on, that is a second entry at crew = one.\n\n"
                 "\"worked_by sounds misleading now\" and \"both should mean team\" — "
                 "9 Sep. worked_by is null on a team entry; created_by ran the timer; "
                 "app_user.role_id says who is paid, and in what capacity.\n\n"
                 "[claude] Until entries name who worked, a team is everybody who holds a "
                 "role: that is the head count a team entry is priced and paid at.\n\n"
                 "[claude] trip_leg.service_id is what a billed leg bills as. Every screen "
                 "used to find it by assuming one service is charged per mile.",
           40, 700, 1180, 290)]
files.append(write("04-work-captured.drawio", "Work as it is captured", c, 1340, 1020))

# 05 -- agreements
c = at("entity",40,60) + at("agreement",440,60) + at("agreement_site",840,60) \
  + at("agreement_period",840,200) + at("agreement_service",840,370) + at("site",1240,60)
c += [edge("e50","entity","agreement","signed"),
      edge("e54","agreement","agreement_service","names what it covers"),
      edge("e51","agreement","agreement_site","covers"),
      edge("e52","agreement","agreement_period","throws off monthly"),
      edge("e53","site","agreement_site","covered by",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=1"))]
c += [note("n5", "\"per site and per client. we talked about this. reoccurings should be "
                 "per site or client.\" — 18 Aug. One shape: a basis plus the locations "
                 "it covers.\n\n"
                 "$200 a month per site — \"It's 200 for Traver and 200 for kettleman. "
                 "(Per site)\" — 2 Sep. Bravo hold two subscriptions, one per main site, "
                 "and their agreement is unlimited: \"$400 a month for remote support "
                 "(unlimited)\".\n\n"
                 "\"the default remote support is 2 hours\" — 9 Sep; whether a new "
                 "agreement starts from it is open. The pool is \"set at the client level "
                 "vs the site level\", so the meter sits here rather than per location.\n\n"
                 "\"allotment used and they call. bill per minute at the going rate. also "
                 "can be set as no-charge or deny work\" — 9 Sep.\n\n"
                 "\"retainer does meter but bravo will show infinite right now\" — 18 Aug.\n\n"
                 "\"its from the 1st of a the month til the end of a month. billed for "
                 "upcoming months usage. this month will be given freely\" — 23 Sep. A "
                 "period is charged when it begins, and can be given: covered, charged "
                 "nothing, on purpose.\n\n"
                 "\"whats the difference between on-site and remote? why are they "
                 "categorical instead of universal?\" — 23 Sep. The split answered one "
                 "question, which hours come out of a retainer, and answered it by kind. "
                 "agreement_service names the services an agreement covers, each with its "
                 "own allotment, so an on-site retainer is as easy as a remote one and an "
                 "hour on a service not named is billed.\n\n"
                 "\"allotment for a service shouldnt even a part of its service "
                 "configuration. that should be per client and/or per site\" — 24 Sep. "
                 "agreement_service is the only home an allotment has: for the whole "
                 "client (flat) or per site covered (per_location).\n\n"
                 "[claude] A capped pool is drawn in the order hours were worked, within "
                 "an agreement_period \u2014 a charged period. Hours it covers bill nothing "
                 "by the hour and are paid as a share of that period's charge.",
           40, 600, 1540, 330)]
files.append(write("05-agreements.drawio", "Agreements", c, 1620, 950))

# 06 -- money out
c = at("invoice",40,60) + at("invoice_line",440,60) + at("credit_note",880,60) \
  + at("credit_application",880,300) + at("entity",40,430) + at("site",440,560)
c += [edge("e60","invoice","invoice_line","is made of"),
      edge("e61","entity","credit_note","holds"),
      edge("e62","credit_note","credit_application","is spent by",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0")),
      edge("e63","invoice","credit_application","reduced by"),
      edge("e64","site","invoice_line","taxed by",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1"))]
c += [note("n6", "\"your right i meant per site but can even be overriden as the invoice "
                 "level\" — 3 Sep. The override is stored per line so one invoice can "
                 "carry lines at two sites; setting it across an invoice writes the "
                 "column many times.\n\n"
                 "\"the invoicing should be digital with a email/printed counterpart "
                 "(PDF) and needs to integrate with stripe\" — 5 Aug.\n\n"
                 "[claude] A sent invoice is immutable and a credit note is the only way "
                 "to change what a client owes. Credits belong to the entity, never to an "
                 "invoice.\n\n"
                 "[claude] One provenance FK per line, or none, so the return groups by "
                 "what produced each line.\n\n"
                 "\"agreed, add unit type\" — 9 Sep. unit is what qty counts, frozen at "
                 "issue like tax_rate_pct, so a line reads 41.20 mi @ $0.72 without asking "
                 "the service what it is called today. Null where a quantity names "
                 "nothing: a flat charge, an adjustment.", 880, 480, 640, 270)]
files.append(write("06-money-out.drawio", "Money out", c, 1600, 1090))

# 07 -- money in
c = at("payment",40,60) + at("payment_allocation",440,60) + at("refund",440,220) \
  + at("payout",40,300) + at("invoice",840,60)
c += [edge("e70","payment","payment_allocation","is split across"),
      edge("e71","payment","refund","may be reversed by"),
      edge("e72","payout","payment","arrives as",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1")),
      edge("e73","invoice","payment_allocation","is settled by",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=1"))]
c += [note("n7", "[claude] Stripe pays one deposit covering several invoices, net of "
                 "fees, so a payment knows which payout carried it and the payout knows "
                 "what the bank shows.\n\n"
                 "[claude] payment_allocation carries partial payments, and it is why a "
                 "refund never makes an invoice look unpaid: the refund reverses the "
                 "payment, and the invoice is closed by a credit note against the entity.",
           440, 420, 660, 170)]
files.append(write("07-money-in.drawio", "Money in", c, 1260, 620))

# 08 -- operator and record
c = at("operator",40,60) + at("app_user",480,60) + at("session",480,350) \
  + at("record_history",900,410) + at("account_map",900,60) \
  + at("ledger_export",900,180) + at("integration",480,560) + at("migration",40,880)
c += [edge("e80","operator","account_map","maps"),
      edge("e82","app_user","session","is signed in by",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0")),
      edge("e81","app_user","record_history","changed",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0"))]
c += [note("n8", "\"the whole platform is universal. user access is the only separation "
                 "for now. there is no he sees or i see. there is only he creates or i "
                 "do\" — 3 Sep. So app_user has no permission columns. role_id is not "
                 "access: it is the capacity someone is paid in, which pay rules are "
                 "written against.\n\n"
                 "[claude] A session is a row, not a signed token: one server, one "
                 "database, and every page reads it anyway, so a stateless token would "
                 "save no round trip and cost revocation. Only the SHA-256 of the cookie "
                 "is stored, so a copy of this table lets nobody in \u2014 the same "
                 "reason credential is a hash.\n\n"
                 "[claude] migration is the applied-schema record db/apply.sh keeps, so "
                 "re-running it applies only what a database has not seen.\n\n"
                 "\"it should not detract from an operator supplied logo. we must create "
                 "a settings page so eevrything required can be operator supplied\" — "
                 "3 Sep. logo is nullable and the interface renders trading_name in its "
                 "place.\n\n"
                 "[claude] the subscription defaults left the operator in 0017 and the "
                 "service in 0023: an included-hours figure is a client's, on their "
                 "agreement, and what is paid to whoever answers is a dated "
                 "pay_rule.\n\n"
                 "[claude] record_history is append-only and exists to explain a figure, "
                 "not to police one.", 40, 1000, 1300, 280)]
files.append(write("08-operator-and-record.drawio", "The operator, and the record", c, 1400, 1320))

for f in files:
    print(f"  {f}")
print(f"\n{len(files)} files, {len(T)} tables")
