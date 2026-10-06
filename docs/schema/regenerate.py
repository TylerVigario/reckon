#!/usr/bin/env python3
"""Seed the .drawio schema diagrams from one definition of the tables.

WARNING: this OVERWRITES every .drawio file beside it. A box moved or a note
added in draw.io is lost the next time it runs, so once a diagram is edited by
hand, the .drawio file is the source and this script is not.

Table definitions here mirror app/src/lib/server/db/schema. Notes say why a
table is the shape it is.

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
           "fillColor=#ffffff;strokeColor=#4f6d8a;fontColor=#273142;fontSize=13;")
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
         "fontColor=#273142;fontSize=13;verticalAlign=middle;")
S_BOX_HI = S_BOX.replace("strokeColor=#4a5468", "strokeColor=#4f6d8a;strokeWidth=2")
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
        colour = "#4f6d8a" if key else "#141a2b"
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

    Opened only in draw.io, overlapping text goes unnoticed until a printable is
    built and press reports text on text. The check belongs where the layout is
    decided.

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
    ("","payment_method","text"),
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
T["unit"] = [("PK","id","uuid"),("UK","name","text · the operator's"),
    ("","short","text · beside a figure"),("","places","int · 0–4"),("","created_at","timestamptz")]
T["material"] = [("PK","id","uuid"),("","sku","text"),("","name","text"),
    ("","brand","text"),("FK","unit_id","uuid · counted in"),("","markup_pct","numeric"),
    ("","taxable","bool"),("","reorder_level","numeric"),("","active","bool")]
T["material_lot"] = [("PK","id","uuid"),("FK","material_id","uuid"),
    ("","received_on","date"),("","supplier","text"),
    ("","qty_received","numeric"),("","qty_remaining","numeric"),
    ("","ex_tax_cost","numeric · all of it, as the receipt says"),
    ("","tax_paid","numeric · all of it"),
    ("FK","paid_by","uuid · null = the business"),
    ("","receipt","bytea · photo or PDF"),("","receipt_type","text")]
T["material_price"] = [("PK","id","uuid"),("FK","material_id","uuid"),
    ("","price","numeric"),("","effective_from","date")]

T["time_entry"] = [("PK","id","uuid"),("UK","client_uuid","uuid · from the phone"),
    ("","worked_on","date · the day it started"),("","seconds","int · from its times"),
    ("","started_at","timestamptz · null = a length"),("","ended_at","timestamptz"),
    ("","zone","text · where it was worked"),
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
    ("FK","site_id","uuid · null = the whole client"),("","price","numeric · a period"),
    ("","starts_on","date"),("","ends_on","date")]
T["agreement_service"] = [("PK","id","uuid"),("FK","agreement_id","uuid"),
    ("FK","service_id","uuid · once per agreement"),("","allotment","capped | unlimited"),
    ("","included_hours","numeric · capped only"),
    ("","overage","bill|no_charge|deny · capped only")]
T["agreement_period"] = [("PK","id","uuid"),("FK","agreement_id","uuid"),
    ("","period_start","date"),("","period_end","date"),
    ("","amount","numeric · as charged"),("","given","bool · charged nothing, on purpose")]

T["invoice"] = [("PK","id","uuid"),("UK","number","text"),("FK","entity_id","uuid"),
    ("","status","draft|sent|paid|void"),("","issued_on","date"),("","due_on","date"),
    ("","period_start","date"),("","period_end","date"),("UK","public_token","text"),
    ("","token_expires_on","date"),("","sent_at","timestamptz"),
    ("FK","created_by","uuid"),("","void_reason","text"),("","created_at","timestamptz")]
T["invoice_line"] = [("PK","id","uuid"),("UK","client_uuid","uuid · from the phone"),
    ("FK","invoice_id","uuid"),("","seq","int"),
    ("","kind","service|material|recurring|adjustment|bought|paid_for"),("","description","text"),
    ("","qty","numeric"),("","unit","text · as billed"),
    ("","unit_price","numeric · as billed"),
    ("FK","site_id","uuid"),("","taxable","bool"),
    ("","tax_rate_pct","numeric · as applied"),("","tax_source","none|site|override|exempt"),
    ("","tax_override_reason","text"),("","ex_tax_cost","numeric · snapshot"),
    ("","tax_paid","numeric · snapshot"),("","amount","numeric"),
    ("FK","time_entry_id","uuid"),("FK","trip_leg_id","uuid"),
    ("FK","agreement_period_id","uuid"),("FK","material_id","uuid · drawn from stock"),
    ("","bought_from","text · from whom"),("FK","paid_by","uuid · null = the business"),
    ("","receipt","bytea · photo or PDF"),("","receipt_type","text")]
T["stock_draw"] = [("PK","invoice_line_id","uuid · with material_id"),
    ("PK","material_lot_id","uuid · with material_id"),
    ("FK","material_id","uuid · the line's, and the lot's"),
    ("","qty","numeric · off this lot")]
T["credit_note"] = [("PK","id","uuid"),("UK","number","text"),("FK","entity_id","uuid"),
    ("","issued_on","date"),("","amount","numeric"),
    ("","kind","reg1700b|correction|goodwill"),("","reason","text"),
    ("FK","created_by","uuid"),("","created_at","timestamptz")]
T["credit_application"] = [("PK","id","uuid"),("FK","credit_note_id","uuid"),("FK","invoice_id","uuid"),
    ("","amount","numeric"),("","applied_on","date")]

T["payment"] = [("PK","id","uuid"),("FK","entity_id","uuid"),("","received_on","date"),
    ("","gross","numeric"),("","method","card|transfer|cheque|cash|other"),
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
    ("","currency","text"),("","timezone","text"),("","locale","text · BCP 47"),
    ("","tax_rule_set","us_ca|flat_per_site|none"),("","invoice_number_format","text"),
    ("","next_invoice_number","int"),
    ("","default_terms_days","int"),("","ageing_alert_days","int"),
    ("","default_markup_pct","numeric · 25"),("","purchase_markup_pct","numeric · 0"),
    ("","stock_costing","average|oldest_first"),
    ("","invoice_footer","text"),("","auto_send","bool"),
    ("","email_attaches_pdf","bool"),("","email_includes_payment_link","bool"),
    ("","tax_registration","text"),("","tax_agency","text"),
    ("","filing_basis","annual|quarterly|monthly"),
    ("","fiscal_year_end_month","1–12"),
    ("","claims_tax_paid_purchases_resold","bool"),
    ("","mileage_assignment","actual|round_trip_per_client")]
T["user"] = [("PK","id","uuid"),("","name","text"),("UK","email","text · lowercase"),
    ("","email_verified","bool"),("","image","text"),
    ("FK","role_id","uuid · null = not paid"),("","active","bool"),
    ("","timezone","text · null = the business's"),("","locale","text · null = the business's"),
    ("","hour_cycle","h12|h23 · null = the locale's"),("","week_start","1–7 · null = the locale's"),
    ("","created_at","timestamptz"),("","updated_at","timestamptz")]
T["session"] = [("PK","id","uuid"),("FK","user_id","uuid"),
    ("UK","token","text · signed in the cookie"),("","expires_at","timestamptz"),
    ("","ip_address","text"),("","user_agent","text"),
    ("","created_at","timestamptz"),("","updated_at","timestamptz")]
T["account"] = [("PK","id","uuid"),("FK","user_id","uuid"),
    ("","provider_id","text · credential = a password"),("","account_id","text"),
    ("","password","text · argon2id"),("","access_token","text"),
    ("","refresh_token","text"),("","id_token","text"),
    ("","access_token_expires_at","timestamptz"),
    ("","refresh_token_expires_at","timestamptz"),("","scope","text"),
    ("","created_at","timestamptz"),("","updated_at","timestamptz")]
T["verification"] = [("PK","id","uuid"),("","identifier","text"),("","value","text"),
    ("","expires_at","timestamptz"),("","created_at","timestamptz"),
    ("","updated_at","timestamptz")]
T["record_history"] = [("PK","id","bigint"),("","table_name","text"),("","row_id","uuid"),
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
c += [box("b_base", "operator · user · record_history", 40, 430, 960, 44)]
for i, src in enumerate(("b_time","b_trip","b_agr","b_lot")):
    c += [edge(f"e1{i}", src, "b_line", "becomes a line" if i == 0 else "", S_EDGE_PLAIN)]
c += [edge("e14","b_line","b_inv","belongs to",S_EDGE_PLAIN),
      edge("e15","b_line","b_cn","corrected by",S_EDGE_PLAIN),
      edge("e16","b_inv","b_pay","settles",S_EDGE_PLAIN),
      edge("e17","b_pay","b_pout","batched into",S_EDGE_PLAIN),
      edge("e18","b_line","b_led","posts",S_EDGE_PLAIN)]
c += [note("n1", "Nothing flows backwards. A sent invoice never reaches back "
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
c += [note("n2", "One building can host two businesses and one person can act for "
                 "several clients, so both joins are many-to-many.\n\n"
                 "A site carries the rate CDTFA’s API returned for its address, their "
                 "name for the area and their TAC, and the day it was asked; nothing in "
                 "the application can author a rate. site_tax_check keeps every answer, "
                 "so a rate that moved can be explained against the invoices billed at "
                 "the old one. A second copy of a published rate goes stale without "
                 "telling anyone, and is then charged at addresses it was never true "
                 "for.\n\n"
                 "CDTFA’s published rate layer carries StateRate, CountyRate and "
                 "CityRate beside the total, keyed by the same TAC the rate API returns "
                 "— StateRate is one value for every jurisdiction in the state, so the "
                 "statewide rate is read rather than assumed, and "
                 "State+County+City = RATE on every record. That split is what lets tax "
                 "collected post to the right obligation: it is not income, it is "
                 "somebody else’s money held briefly. tax_remittance records what was "
                 "actually handed over, because no invoice knows that. County and city "
                 "fold into one district share, because CDTFA-105 is a list of districts"
                 " and names no other kind.\n\n"
                 "Every site has a rate from the API, so the address and the answer are "
                 "NOT NULL together: the lookup takes street, city and postcode or "
                 "answers nothing, and a place with no rate cannot be billed from — so "
                 "it is not a site. Creating one is a lookup, not a form"
                 " that can be half-filled.\n\n"
                 "A contact is named per client and per site, and a person is shared: "
                 "one contact acts for several clients, which is why contact has no "
                 "owner. What is per client is entity_contact, and what is per site is "
                 "site_contact — several people at a site, one of them answering first, "
                 "and a site naming nobody falling back to the client’s primary. "
                 "site_contact carries the client so two foreign keys can agree: the "
                 "site is that client’s and the person is that client’s contact.\n\n"
                 "A site belongs to exactly one client; two clients at one address are "
                 "two sites.",
           40, 720, 1480, 280)]
files.append(write("02-who-and-where.drawio", "Who and where", c, 1560, 1040))

# 03 -- catalogue
c = at("service",40,60) + at("service_price",440,60) + at("pay_rule",440,280) \
  + at("role",840,400) \
  + at("material",840,60) + at("material_lot",1240,60) + at("material_price",1240,370) \
  + at("unit",1240,530)
c += [edge("e30","service","service_price","priced by"),
      edge("e31","service","pay_rule","pays by"),
      edge("e34","role","pay_rule","is paid by",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=1")),
      edge("e32","material","material_lot","received as"),
      edge("e33","material","material_price","may pin"),
      edge("e35","material","unit","counted in")]
c += [note("n3", "A service is configured, not categorised: what it is charged per, how "
                 "finely, at least what, and whom it pays.\n\n"
                 "rate is the first person's and additional_rate each extra person's: "
                 "at $120 and +$70 a crew of three costs $260 an hour.\n\n"
                 "Pay is for work done. Each pay_rule is for a role or for one person, pays "
                 "for time or a vehicle — hourly to the second, as a share of the "
                 "line, as a fixed sum, or not at all. Among rules in force, a client's "
                 "own comes first, then a person's own, then the role's.\n\n"
                 "A vehicle rule pays whoever owns the vehicle, so a vehicle the "
                 "business owns pays nobody.\n\n"
                 "A covered_time rule pays a percentage of the period's retainer "
                 "charge, divided by each person's part of the covered time.\n\n"
                 "unit each charges per entry, whatever its length: a flat rate.\n\n"
                 "unit is how a service is charged; time_tracked is whether time is "
                 "captured against it. Mileage may be timed and still billed per mile.\n\n"
                 "Allotments live on agreements, service by service, never on the "
                 "service itself.\n\n"
                 "bill_to_nearest_seconds and minimum_charge are the usual next"
                 " questions about an hourly price. Pay is never rounded to them; it is "
                 "counted as worked.\n\n"
                 "material_lot is where stock enters, and where the Reg 1701 "
                 "ex-tax purchase price is sourced. It keeps what all of it cost before "
                 "tax and in tax, as the receipt says them, and a unit's share is worked "
                 "out from those. A line drawn from stock takes the oldest lots first, and "
                 "qty_remaining follows what it took (stock_draw). paid_by "
                 "is whoever paid out of their own pocket and is owed it back, or the "
                 "business when empty.\n\n"
                 "A material is counted in one of the operator's units -- each, the foot, "
                 "a box of 25 -- each with how it is written and how many places a "
                 "quantity may have. Nothing converts one unit into another, and a line "
                 "keeps its unit's name as it was billed.", 40, 740, 1540, 360)]
files.append(write("03-catalogue.drawio", "What you sell", c, 1620, 1140))

# 04 -- work captured
c = at("time_entry",40,60) + at("trip",480,60) + at("trip_stop",480,220) \
  + at("trip_leg",880,60) + at("user",40,480) + at("entity",880,300)
c += [edge("e40","user","time_entry","worked / created",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1")),
      edge("e41","trip","trip_stop","visits",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0")),
      edge("e42","trip","trip_leg","is made of"),
      edge("e43","entity","trip_leg","caused",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1"))]
c += [note("n4", "started_at and ended_at are when the work was done and zone is where, so it "
                 "is shown as it was worked; seconds is worked out from them by the server, and "
                 "worked_on is the day it started there. An entry recorded before it kept its "
                 "times has its length alone.\n\n"
                 "worked_by is who worked the hour, and crew says whether it bills at one "
                 "person's rate or the team's; created_by is who entered it, which is how the row "
                 "is explained later.\n\n"
                 "client_uuid is made on the phone: the offline queue retries, "
                 "and without it a retry that timed out enters the hour twice.\n\n"
                 "Work done by the whole crew is one row with crew = team, so its "
                 "billable quantity is recorded, not worked out. Anyone who carries on "
                 "alone afterwards gets a row of their own at crew = one.\n\n"
                 "A team row has no worked_by. created_by is whoever ran the timer, "
                 "and user.role_id is what decides pay.\n\n"
                 "The team is every active person with a role; that number is the "
                 "head count a team row is priced and paid at.\n\n"
                 "trip_leg.service_id is what a billed leg bills as, so nothing "
                 "has to assume that only one service is charged per mile.",
           40, 830, 1180, 350)]
files.append(write("04-work-captured.drawio", "Work as it is captured", c, 1340, 1220))

# 05 -- agreements
c = at("entity",40,60) + at("agreement",440,60) \
  + at("agreement_period",840,60) + at("agreement_service",840,250) + at("site",440,400)
c += [edge("e50","entity","agreement","signed"),
      edge("e54","agreement","agreement_service","names what it covers"),
      edge("e52","agreement","agreement_period","one per interval"),
      edge("e53","site","agreement","may be for",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1"))]
c += [note("n5", "With site_id empty the agreement is the client's; with it set, it is "
                 "that site's and comes first for work there. A client may hold one of "
                 "its own, one per site, or both.\n\n"
                 "No allotment is assumed: each agreement states its own, and the hours "
                 "are shared by every site the agreement reaches, so the meter belongs "
                 "to the agreement.\n\n"
                 "Past the allotment an hour bills at the going rate, to the service's "
                 "increment, or is not charged, or is refused.\n\n"
                 "A retainer meters its hours, and an unlimited one shows no cap.\n\n"
                 "A period is charged when it begins, and can be given: covered, charged"
                 " nothing, on purpose.\n\n"
                 "agreement_service lists what an agreement covers, service by service, "
                 "each with its own allotment. Any service can be put on a retainer, "
                 "and one the agreement does not list bills as usual.\n\n"
                 "A capped pool is drawn in the order hours were worked, within"
                 " an agreement_period — a charged period. Hours it covers bill nothing "
                 "by the hour and are paid as a share of that period's charge.",
           880, 470, 700, 560)]
files.append(write("05-agreements.drawio", "Agreements", c, 1620, 1060))

# 06 -- money out
c = at("invoice",40,60) + at("invoice_line",440,60) + at("credit_note",880,60) \
  + at("credit_application",880,300) + at("entity",40,430) + at("site",440,660) \
  + at("stock_draw",880,860) + at("material_lot",1240,860)
c += [edge("e60","invoice","invoice_line","is made of"),
      edge("e65","invoice_line","stock_draw","drew"),
      edge("e66","stock_draw","material_lot","comes off"),
      edge("e61","entity","credit_note","holds"),
      edge("e62","credit_note","credit_application","is spent by",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0")),
      edge("e63","invoice","credit_application","reduced by"),
      edge("e64","site","invoice_line","taxed by",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1"))]
c += [note("n6", "A tax override is stored per line, so one invoice can carry lines at "
                 "two sites; setting it across an invoice writes the column many times.\n\n"
                 "Emailing an invoice, printing it as a PDF and taking card payment "
                 "through Stripe are planned; none is built yet.\n\n"
                 "A sent invoice is immutable and a credit note is the only way"
                 " to change what a client owes. Credits belong to the entity, never to "
                 "an invoice.\n\n"
                 "One provenance FK per line, or none, so the return groups by "
                 "what produced each line.\n\n"
                 "A line drawn from stock names its material, and stock_draw what it took "
                 "off each lot, oldest first; a trigger takes that off the lot's "
                 "qty_remaining and puts it back if the draw goes. It is costed at the "
                 "average of what is on the shelf, or the oldest first, as "
                 "operator.stock_costing says, and keeps the cost it was drawn at.\n\n"
                 "unit is what qty counts, frozen at issue like tax_rate_pct, so a line "
                 "keeps its unit if the service is later changed. Null when "
                 "the quantity counts nothing, as on a flat charge or an adjustment.\n\n"
                 "What is bought for a job, or paid on the client's behalf, is a line of "
                 "its own kind: from whom, who paid -- a person, who is owed it back, or "
                 "the business -- and its receipt.\n\n"
                 "A line added by hand is saved on the phone first and sent when there "
                 "is a signal; client_uuid, made on the phone, keeps a retry from adding "
                 "it twice.", 880, 480, 640, 330)]
files.append(write("06-money-out.drawio", "Money out", c, 1600, 1200))

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
c += [note("n7", "Stripe pays one deposit covering several invoices, net of "
                 "fees, so a payment knows which payout carried it and the payout knows "
                 "what the bank shows.\n\n"
                 "payment_allocation carries partial payments, and it is why a "
                 "refund never makes an invoice look unpaid: the refund reverses the "
                 "payment, and the invoice is closed by a credit note against the entity.",
           440, 420, 660, 170)]
files.append(write("07-money-in.drawio", "Money in", c, 1260, 620))

# 08 -- operator and record
c = at("operator",40,60) + at("user",480,60) + at("session",480,410) \
  + at("account",480,650) + at("record_history",900,410) + at("account_map",900,60) \
  + at("ledger_export",900,180) + at("integration",900,650) + at("verification",900,800)
c += [edge("e80","operator","account_map","maps"),
      edge("e82","user","session","is signed in by",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0")),
      edge("e83","user","account","signs in with",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=0")),
      edge("e81","user","record_history","changed")]
c += [note("n8", "Anyone who can sign in can see and change everything: "
                 "user has no permission columns. role_id is not access: it is the "
                 "capacity someone is paid in, which pay rules are written against.\n\n"
                 "Each person keeps a time zone, a locale, a clock and a first day of the "
                 "week. Empty follows the business's -- its own timezone and locale -- or "
                 "what the locale says.\n\n"
                 "user, session, account and verification are Better Auth's, in its "
                 "shape. A password is an account whose provider_id is credential, and "
                 "what it holds is an argon2id hash. There is no sign-up: people are "
                 "added from the command line.\n\n"
                 "A session is a row, not a stateless token: one server, one "
                 "database, and every page reads it anyway, so a stateless token would "
                 "save no round trip and cost revocation. The cookie is the token "
                 "signed with the server's secret, so a copy of this table lets nobody "
                 "in without the secret as well.\n\n"
                 "Which migrations a database has seen is Drizzle's record, in "
                 "drizzle.__drizzle_migrations, so re-running db/apply.sh applies only "
                 "what is new.\n\n"
                 "Everything that identifies the business is the operator's to supply: "
                 "logo is nullable and the interface renders trading_name in its place.\n\n"
                 "An included-hours figure is a client's, on their agreement, "
                 "and what is paid to whoever answers is a dated pay_rule.\n\n"
                 "record_history is append-only and exists to explain a figure,"
                 " not to police one.", 40, 1000, 1300, 330)]
files.append(write("08-operator-and-record.drawio", "The operator, and the record", c, 1400, 1370))

for f in files:
    print(f"  {f}")
print(f"\n{len(files)} files, {len(T)} tables")
