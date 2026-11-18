#!/usr/bin/env python3
"""Seed the .drawio schema diagrams from one definition of the tables.

WARNING: this OVERWRITES every .drawio file beside it. A box moved or a note
added in draw.io is lost the next time it runs, so once a diagram is edited by
hand, the .drawio file is the source and this script is not.

Table definitions here describe what the migrations make,
src/lib/server/db/migrations: every table, every column, and its type or, for
one of the schema's types, its words. npm run db:drift checks them against a
database the migrations build (scripts/db-types.mjs), and fails on any table,
column or type they disagree on. Notes say why a table is the shape it is.

Usage:  python3 regenerate.py
        python3 regenerate.py --tables    the definitions, as JSON; writes nothing
"""

import json
import pathlib
import re
import sys
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
    ("","google_place_id","text · the place chosen"),("","address_verified_on","date"),
    ("FK","tax_area_id","uuid · the place it is in"),
    ("","area_verified_on","date · last asked, NOT NULL"),
    ("","google_round_trip_miles","numeric · Google's route"),
    ("","google_drive_minutes","int · Google's, one way"),
    ("","typed_round_trip_miles","numeric · typed over it"),
    ("","typed_drive_minutes","int · typed over it"),
    ("","round_trip_miles","numeric · generated: in force"),
    ("","drive_minutes","int · generated: in force"),
    ("","active","bool"),
    ("","created_at","timestamptz")]
T["contact"] = [("PK","id","uuid"),("","name","text"),("","email","text"),
    ("","phone","text"),("","note","text")]
T["entity_contact"] = [("FK","entity_id","uuid"),("FK","contact_id","uuid"),
    ("","is_primary","bool")]
T["site_contact"] = [("FK","site_id","uuid"),("FK","entity_id","uuid · carried"),
    ("FK","contact_id","uuid"),("","is_primary","bool")]
T["tax_area"] = [("PK","id","uuid"),("UK","state","text · two letters, with code"),
    ("UK","code","text · its authority's, e.g. a TAC"),
    ("","name","text · as its authority names it"),("","source","tax_area_source"),
    ("","confirmed_on","date · last confirmed"),("","created_at","timestamptz")]
T["tax_piece"] = [("PK","id","uuid"),("FK","area_id","uuid"),
    ("","level","federal|state|local"),("","jurisdiction","text · who levies it"),
    ("","code","text · its authority's"),("","rate_pct","numeric"),
    ("","effective_from","date · a set's, newest in force")]
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
    ("","minimum_charge","numeric · null = none"),("","active","bool"),
    ("UK","client_uuid","uuid · added on a phone")]
T["service_price"] = [("PK","id","uuid"),("FK","service_id","uuid"),
    ("FK","entity_id","uuid · null = every client"),("","rate","numeric · the first person"),
    ("","additional_rate","numeric · each one after"),("","effective_from","date")]
T["pay_rule"] = [("PK","id","uuid"),("FK","service_id","uuid"),
    ("FK","role_id","uuid · a role, or"),("FK","user_id","uuid · one person"),
    ("FK","entity_id","uuid · null = every client"),("","pays_for","time|covered_time|vehicle"),
    ("","method","per_hour|percent|fixed|nothing"),("","amount","numeric · none for nothing"),
    ("","effective_from","date"),("","created_at","timestamptz")]
T["role"] = [("PK","id","uuid"),("UK","name","text · the operator's word"),
    ("","pays_as","pays_as · null = not said"),
    ("","created_at","timestamptz")]
T["unit"] = [("PK","id","uuid"),("UK","name","text · the operator's"),
    ("","short","text · beside a figure"),("","places","int · 0–4"),("","created_at","timestamptz")]
T["material"] = [("PK","id","uuid"),("","sku","text"),("","name","text"),
    ("","brand","text"),("FK","unit_id","uuid · counted in"),("","markup_pct","numeric"),
    ("","taxable","bool"),("","reorder_level","numeric · nothing reads it yet"),("","active","bool"),
    ("","version","int · its saves"),("UK","client_uuid","uuid · received on a phone")]
T["material_lot"] = [("PK","id","uuid"),("FK","material_id","uuid"),
    ("FK","receipt_id","uuid · the receipt it came on, or"),
    ("FK","adjustment_id","uuid · the find it was"),
    ("","received_on","date · oldest drawn first"),
    ("","qty_received","numeric"),("","qty_remaining","numeric"),
    ("","ex_tax_cost","numeric · all of it, as the receipt says"),
    ("","tax_paid","numeric · its share of the receipt's")]
T["stock_receipt"] = [("PK","id","uuid"),("","received_on","date"),("","supplier","text"),
    ("","reference","text · the receipt's own number"),
    ("FK","paid_by","uuid · null = the business"),
    ("","tax_paid","numeric · all the receipt charged"),
    ("","receipt","bytea · photo or PDF"),("","receipt_type","receipt_type"),
    ("UK","client_uuid","uuid · sent twice, one receipt"),("","created_at","timestamptz")]
T["stock_adjustment"] = [("PK","id","uuid"),("FK","material_id","uuid"),
    ("","made_on","date"),("","way","off|on"),("","qty","numeric · more than nothing"),
    ("","reason","stock_adjustment_reason"),("","note","text"),
    ("","ex_tax_cost","numeric · what it moved, at cost"),("","tax_paid","numeric"),
    ("FK","count_id","uuid · the count it puts right"),
    ("UK","client_uuid","uuid · with created_by"),("FK","created_by","uuid"),
    ("","created_at","timestamptz")]
T["stock_take"] = [("PK","adjustment_id","uuid · with the lot"),
    ("PK","material_lot_id","uuid · with material_id"),
    ("FK","material_id","uuid · the adjustment's, and the lot's"),
    ("","qty","numeric · off this lot")]
T["stock_count"] = [("PK","id","uuid"),("","counted_on","date"),
    ("UK","client_uuid","uuid · with created_by"),("FK","created_by","uuid"),
    ("","created_at","timestamptz"),("","applied_at","timestamptz · null = still open"),
    ("FK","applied_by","uuid")]
T["stock_count_line"] = [("PK","id","uuid"),("FK","count_id","uuid"),
    ("FK","material_id","uuid · once per count"),("","counted","numeric · what was there"),
    ("","on_hand","numeric · what the shelf said"),
    ("","cost_each","numeric · only where none is"),
    ("FK","counted_by","uuid"),("","counted_at","timestamptz")]
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
    ("","note","text"),("","version","int · its saves, 1 when made"),("","created_at","timestamptz")]
T["time_entry_crew"] = [("PK","time_entry_id","uuid · a team entry"),
    ("PK","user_id","uuid · one of its crew")]
T["trip"] = [("PK","id","uuid"),("","travelled_on","date"),("FK","driven_by","uuid"),
    ("FK","created_by","uuid"),("","created_at","timestamptz"),
    ("FK","vehicle_id","uuid · null = not recorded"),
    ("UK","client_uuid","uuid · made where it was recorded"),("","note","text · what it was for"),
    ("","odometer_start","numeric · null = not read"),("","odometer_end","numeric"),
    ("","start_address","text · null = the base"),("","end_address","text · null = the base")]
T["trip_stop_client"] = [("PK","trip_stop_id","uuid"),("PK","entity_id","uuid · who it was for"),
    ("FK","site_id","uuid · null = not at their site"),("","asked_there","bool · pays for none of it")]
T["vehicle"] = [("PK","id","uuid"),("","name","text"),
    ("FK","owner_id","uuid · null = the business's"),("","retired_on","date · null = in use"),
    ("","created_at","timestamptz")]
T["trip_stop"] = [("PK","id","uuid"),("FK","trip_id","uuid"),("","seq","int"),
    ("FK","site_id","uuid"),("","arrived_at","timestamptz"),
    ("","departed_at","timestamptz"),("","address","text · not a site")]
T["trip_leg"] = [("PK","id","uuid"),("FK","trip_id","uuid"),("","seq","int"),
    ("","miles","numeric"),("FK","entity_id","uuid · who caused it"),
    ("FK","site_id","uuid"),("FK","service_id","uuid · what it bills as"),("","rule","trip_leg_rule"),
    ("FK","to_stop_id","uuid · null = the way back")]

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

T["invoice"] = [("PK","id","uuid"),("UK","client_uuid","uuid · started on a phone"),
    ("UK","number","text"),("FK","entity_id","uuid"),
    ("","status","draft|sent|void"),("","issued_on","date"),("","due_on","date"),
    ("","period_start","date"),("","period_end","date"),("UK","public_token","text · the client's link"),
    ("","token_expires_on","date · none set"),("","sent_at","timestamptz"),
    ("FK","created_by","uuid"),("","void_reason","text"),("","created_at","timestamptz")]
T["invoice_line"] = [("PK","id","uuid"),("UK","client_uuid","uuid · from the phone"),
    ("","version","int · its saves, 1 when added"),
    ("FK","invoice_id","uuid"),("","seq","int"),
    ("","kind","service|material|recurring|adjustment|bought|paid_for"),("","description","text"),
    ("","qty","numeric"),("","unit","text · as billed"),
    ("","unit_price","numeric · as billed"),
    ("FK","site_id","uuid"),("","taxable","bool"),
    ("","tax_rate_pct","numeric · as applied"),("","tax_source","none|site|override|exempt"),
    ("","tax_jurisdiction","text · CDTFA's area, as taxed"),
    ("","state_rate_pct","numeric · the state's share"),
    ("","district_rate_pct","numeric · the districts'"),
    ("","tax_override_reason","text"),("","ex_tax_cost","numeric · snapshot"),
    ("","tax_paid","numeric · snapshot"),("","amount","numeric"),
    ("FK","time_entry_id","uuid"),("FK","trip_leg_id","uuid"),
    ("FK","agreement_period_id","uuid"),("FK","material_id","uuid · drawn from stock"),
    ("FK","moved_from_invoice_id","uuid · meant for, gone out"),
    ("","bought_from","text · from whom"),("FK","paid_by","uuid · null = the business"),
    ("","receipt","bytea · photo or PDF"),("","receipt_type","receipt_type"),
    ("FK","created_by","uuid · who added it")]
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
    ("","tax_number","text"),("","tax_number_label","text · EIN, VAT, ABN…"),
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
T["person_payment"] = [("PK","id","uuid"),("FK","user_id","uuid · who was paid"),
    ("","paid_on","date"),("","how","text · bank transfer, cash…"),("","note","text"),
    ("UK","client_uuid","uuid · made where it was recorded"),("FK","created_by","uuid · who recorded it"),
    ("","created_at","timestamptz")]
T["person_payment_item"] = [("PK","id","uuid"),("FK","payment_id","uuid"),
    ("FK","user_id","uuid · the payment's person"),("FK","time_entry_id","uuid · an entry's time, or"),
    ("FK","trip_id","uuid · a trip's miles, or"),("FK","corrects_payment_id","uuid · an earlier payment"),
    ("","amount","numeric · as it came to"),("","said","text · how, in words"),
    ("","paid_as","paid_as · its pay, or a refund")]
T["user"] = [("PK","id","uuid"),("","name","text"),("UK","email","text · lowercase"),
    ("","email_verified","bool · a link there was used"),("","image","text"),
    ("FK","role_id","uuid · null = not paid"),("","active","bool"),
    ("","access","full|field · what they reach"),
    ("","last_signed_in_at","timestamptz · null = never"),
    ("","timezone","text · null = the business's"),("","locale","text · null = the business's"),
    ("","hour_cycle","h12|h23 · null = the locale's"),("","week_start","1–7 · null = the locale's"),
    ("","created_at","timestamptz"),("","updated_at","timestamptz")]
T["session"] = [("PK","id","uuid"),("FK","user_id","uuid"),
    ("UK","token","text · signed in the cookie"),("","expires_at","timestamptz"),
    ("","ip_address","text"),("","user_agent","text"),
    ("","created_at","timestamptz"),("","updated_at","timestamptz")]
T["account"] = [("PK","id","uuid"),("FK","user_id","uuid"),
    ("","provider_id","text"),("","account_id","text"),
    ("","password","text · always null"),("","access_token","text"),
    ("","refresh_token","text"),("","id_token","text"),
    ("","access_token_expires_at","timestamptz"),
    ("","refresh_token_expires_at","timestamptz"),("","scope","text"),
    ("","created_at","timestamptz"),("","updated_at","timestamptz")]
T["verification"] = [("PK","id","uuid"),("","identifier","text · in a cookie"),
    ("","value","text · a passkey's challenge"),
    ("","expires_at","timestamptz"),("","created_at","timestamptz"),
    ("","updated_at","timestamptz")]
T["passkey"] = [("PK","id","uuid"),("FK","user_id","uuid"),
    ("","name","text · theirs to change"),("","public_key","text · the only half here"),
    ("UK","credential_id","text · WebAuthn's"),("","counter","int"),
    ("","device_type","singleDevice|multiDevice"),("","backed_up","bool · synced now"),
    ("","transports","text"),("","aaguid","text · what made it"),
    ("","created_at","timestamptz"),("","last_used_at","timestamptz"),
    ("","last_used_from","text · browser and system")]
T["email_link"] = [("PK","id","uuid"),("FK","user_id","uuid"),
    ("","purpose","invite|reset|confirm|change"),
    ("UK","code_hash","bytea · SHA-256, never the code"),
    ("","sent_to","text · what using it proves"),("","created_at","timestamptz"),
    ("","expires_at","timestamptz · an hour at most"),
    ("","used_at","timestamptz · null = not yet"),
    ("FK","sent_by","uuid · Full, or themselves")]
T["link_try"] = [("PK","id","uuid"),("","created_at","timestamptz"),
    ("","address","inet"),("","network","cidr · what is counted")]
T["rate_limit"] = [("PK","id","uuid"),("UK","key","text · an address and route"),
    ("","count","int · in the window"),("","last_request","bigint · milliseconds")]
T["security_event"] = [("PK","id","uuid"),("","at","timestamptz · the database's clock"),
    ("","name","security_event_name"),("FK","user_id","uuid · whom it is about"),
    ("FK","by_id","uuid · who did it, if not them"),
    ("","client_address","inet"),("","user_agent","text · 512 at most"),
    ("","detail","jsonb · never a secret")]
T["email_message"] = [("PK","id","uuid · its Message-ID"),("","created_at","timestamptz"),
    ("","kind","email_message_kind"),("FK","user_id","uuid · null = nobody's"),
    ("","to_address","text"),("","subject","text"),
    ("","body","text · null once sent or given up"),("","html","text · beside body"),
    ("","send_by","timestamptz · then given up"),("","next_try_at","timestamptz"),
    ("","tries","smallint"),("","claimed_until","timestamptz · a sender's"),
    ("","sent_at","timestamptz"),("","gave_up_at","timestamptz"),
    ("","last_error","text · what the relay said")]
T["record_history"] = [("PK","id","bigint"),("","table_name","text"),("","row_id","uuid"),
    ("","field","text"),("","old_value","text"),("","new_value","text"),
    ("FK","changed_by","uuid"),("","changed_at","timestamptz · when it arrived"),
    ("","made_at","timestamptz · when, on a phone"),("","xact","bigint · the save it was in")]
T["account_map"] = [("PK","role","text · what it is for"),("","account","text · as the ledger names it")]
T["ledger_export"] = [("PK","id","uuid"),("","event","text"),("","source_table","text"),
    ("","source_id","uuid"),("","dated_on","date"),("","exported_at","timestamptz"),
    ("","transaction_text","text")]


if "--tables" in sys.argv:
    # What npm run db:drift checks against the migrations: every table here, as
    # [key, column, type or words · a note] rows.
    print(json.dumps(T))
    raise SystemExit(0)


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
  + at("contact",800,650) + at("entity_contact",440,240) \
  + at("site_contact",440,460) \
  + at("site_tax_check",1200,60) + at("tax_remittance",1200,340) \
  + at("tax_area",1200,640) + at("tax_piece",1200,860)
c += [edge("e22","entity","entity_contact","is reached via"),
      edge("e23","contact","entity_contact","acts for",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=1")),
      edge("e26","entity_contact","site_contact","is named at"),
      edge("e27","site","site_contact","asks for",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=1")),
      edge("e24","site","site_tax_check","was priced by CDTFA"),
      edge("e28","tax_area","site","holds",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=1")),
      edge("e29","tax_area","tax_piece","levies",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0"))]
c += [note("n2", "One building can host two businesses and one person can act for "
                 "several clients, so both joins are many-to-many.\n\n"
                 "A rate belongs to a place, not to a site: a tax_area is one place with "
                 "one combination of jurisdictions, named as its authority names it -- "
                 "CDTFA’s area and TAC -- never by a postal city, and its rate is its "
                 "pieces, who levies what, federal, state and local, in dated sets, the "
                 "newest on or before a day in force then. A site is in the area CDTFA’s "
                 "API placed its address in, on the day it was asked; nothing in the "
                 "application can author a rate. site_tax_check keeps every answer, "
                 "so a rate that moved can be explained against the invoices billed at "
                 "the old one. A second copy of a published rate goes stale without "
                 "telling anyone, and is then charged at addresses it was never true "
                 "for.\n\n"
                 "A site’s address is chosen from Google’s suggestions, never typed: "
                 "street, city, region and postcode are Google’s parts for the place "
                 "chosen, stored with google_place_id once Google confirms it, and moved "
                 "only together. A suite or unit is in the label. The google_ figures "
                 "are Google’s route there and back from the business, measured "
                 "whenever the place is chosen and whenever the business moves; the "
                 "typed_ ones are typed over them where somebody knows better, and kept "
                 "beside them so Google’s stays in view. round_trip_miles and "
                 "drive_minutes are generated: the typed figure, or Google’s where none "
                 "is. A site that moves where Google cannot say keeps neither, and what "
                 "was typed goes with the move.\n\n"
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
                 "Every site is in an area from the API, so the address and the area are "
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
           40, 1080, 1480, 300)]
files.append(write("02-who-and-where.drawio", "Who and where", c, 1560, 1420))

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
                 "A role's name is the operator's; pays_as is a fixed list -- a partner's "
                 "guaranteed payments, an employee's wages, a contractor's fees -- since "
                 "that, not the name, decides where pay is reported. Null is a role named "
                 "before it was asked, whose work cannot be paid until it says.\n\n"
                 "A vehicle rule pays whoever owns the vehicle a trip was driven in, "
                 "on each leg — a share or a sum, never by the hour — so a vehicle the "
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
                 "material_lot is where stock enters, on a receipt or found, and where "
                 "the Reg 1701 ex-tax purchase price is sourced. How stock comes and "
                 "goes is Stock's.\n\n"
                 "A material received, or a service added, on a phone with no signal "
                 "keeps the client_uuid the phone made it with: what a line names it by "
                 "until it arrives. A material's version is its saves, so a change made "
                 "from an old copy is told of one made since.\n\n"
                 "A material is counted in one of the operator's units -- each, the foot, "
                 "a box of 25 -- each with how it is written and how many places a "
                 "quantity may have. Nothing converts one unit into another, and a line "
                 "keeps its unit's name as it was billed.", 40, 740, 1540, 360)]
files.append(write("03-catalogue.drawio", "What you sell", c, 1620, 1140))

# 04 -- stock
c = at("material",40,60) + at("stock_count_line",40,420) \
  + at("material_lot",440,60) + at("stock_draw",440,300) + at("stock_count",440,470) \
  + at("stock_receipt",840,60) + at("stock_adjustment",840,380) + at("stock_take",1240,380)
c += [edge("e400","material","material_lot","is on the shelf as"),
      edge("e401","stock_receipt","material_lot","brought in",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=1")),
      edge("e402","material_lot","stock_draw","is drawn by a line",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0")),
      edge("e403","stock_adjustment","material_lot","found as",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0;exitY=0.2")
                 .replace("entryX=0;entryY=0.5","entryX=1;entryY=0.8")),
      edge("e404","stock_adjustment","stock_take","took"),
      edge("e405","material","stock_count_line","is counted on",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0")),
      edge("e406","stock_count","stock_count_line","counts",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=1")),
      edge("e407","stock_count","stock_adjustment","is put right by")]
c += [note("n4", "A stock_receipt is what was bought on one receipt or supplier's invoice: "
                 "from whom, on which day, its own number, who paid -- a person, who is "
                 "owed it back, or the business when empty -- the tax it charged, all of "
                 "it, and the paper itself, kept once. Each item on it is a lot, in its "
                 "own unit, carrying its share of that tax, split by what each cost "
                 "before tax.\n\n"
                 "A material_lot is stock on the shelf: what all of it cost before tax "
                 "and its share of the tax, as the receipt says them, so a unit's share "
                 "is worked out from those and nothing is lost to rounding a cost per "
                 "foot. It came on a receipt or was found, one and never both, and the "
                 "oldest is drawn first.\n\n"
                 "A line drawn from stock takes off the oldest lots first (stock_draw), "
                 "and an adjustment taken off does the same (stock_take). A trigger keeps "
                 "qty_remaining following both, so taking more than is left is refused "
                 "by the lot's own check.\n\n"
                 "A stock_adjustment puts one material's stock right by hand: so much "
                 "off the shelf or on it, on a day, and why. Used, damaged, lost and "
                 "returned only take off; found only puts on, as a lot of its own; a "
                 "correction or a count goes either way. What it moved is held at what "
                 "it cost.\n\n"
                 "A stock_count is what was on the shelf on a day: open while it is "
                 "counted, one open at a time, and applied once, when each difference "
                 "becomes an adjustment that names it. Each line keeps what the shelf "
                 "said when it was counted beside what was there, so stock that moved "
                 "meanwhile is told rather than written over, and a cost each only where "
                 "the shelf has nothing to cost what turned up by.\n\n"
                 "A receipt, an adjustment and a count keep the client_uuid the page or "
                 "the phone made them with: sent twice, each is one.",
           40, 760, 1540, 330)]
files.append(write("04-stock.drawio", "Stock", c, 1620, 1130))

# 05 -- work captured
c = at("time_entry",40,60) + at("user",40,480) + at("time_entry_crew",480,480) \
  + at("vehicle",480,600) + at("trip",880,60) + at("trip_stop",880,400) \
  + at("trip_stop_client",880,620) + at("trip_leg",1280,60) + at("entity",1280,330)
c += [edge("e40","user","time_entry","worked / created",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1")),
      edge("e41","trip","trip_stop","visits",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0")),
      edge("e42","trip","trip_leg","is made of"),
      edge("e44","time_entry","time_entry_crew","names its crew",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.9;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0")),
      edge("e45","user","time_entry_crew","is on",
           S_EDGE.replace("exitY=0.5","exitY=0.1122")),
      edge("e46","trip","vehicle","driven in",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0;exitY=0.9")
                 .replace("entryX=0;entryY=0.5","entryX=1;entryY=0.3")),
      edge("e47","user","vehicle","owns",
           S_EDGE.replace("exitY=0.5","exitY=0.7051").replace("entryY=0.5","entryY=0.7353")),
      edge("e48","trip_stop","trip_stop_client","was for",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0")),
      edge("e49","entity","trip_stop_client","is who",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0;exitY=0.9")
                 .replace("entryX=0;entryY=0.5","entryX=1;entryY=0.5")),
      edge("e43","entity","trip_leg","caused",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1"))]
c += [note("n5", "started_at and ended_at are when the work was done and zone is where, so it "
                 "is shown as it was worked; seconds is worked out from them by the server, and "
                 "worked_on is the day it started there. An entry recorded before it kept its "
                 "times has its length alone. version is its saves, 1 when made: a change "
                 "says which it began from, so one made meanwhile is told.\n\n"
                 "worked_by is who worked the hour, and crew says whether it bills at one "
                 "person's rate or the team's; created_by is who entered it, which is how the row "
                 "is explained later.\n\n"
                 "client_uuid is made on the phone: the offline queue retries, "
                 "and without it a retry that timed out enters the hour twice.\n\n"
                 "Work done by the whole crew is one row with crew = team, so its "
                 "billable quantity is recorded, not worked out. Anyone who carries on "
                 "alone afterwards gets a row of their own at crew = one.\n\n"
                 "A team row has no worked_by. It names its crew in time_entry_crew, "
                 "ticked when the timer starts, and is priced at that head count and pays "
                 "each of them; created_by is whoever ran the timer, and user.role_id is "
                 "what decides pay. A team row recorded before crews were named was given "
                 "everyone who held a role when they began to be.\n\n"
                 "trip_leg.service_id is what a billed leg bills as, so nothing "
                 "has to assume that only one service is charged per mile.\n\n"
                 "trip.vehicle_id is what it was driven in. The vehicle's owner is who "
                 "its miles pay, by the service's vehicle rule, whoever drove; the "
                 "business's own pays nobody. Whose a vehicle is never changes: one that "
                 "changes hands is retired and added again.\n\n"
                 "A trip starts and ends at the base -- start_address and end_address "
                 "say otherwise -- and its stops are places in order, a site or an "
                 "address. trip_stop_client says who each was for: two clients' sites "
                 "at one address are one stop, and one who asked once the driver was "
                 "there pays for none of the drive. The app gives each leg to whoever "
                 "caused it, by the rule in Settings → Travel; rule = chosen where "
                 "somebody gave it by hand. to_stop_id is where a leg went, so the same "
                 "drive later starts from its miles. note and the odometer are the "
                 "trip's own, as a mileage log asks.",
           40, 924, 1576, 380)]
files.append(write("05-work-captured.drawio", "Work as it is captured", c, 1680, 1344))

# 06 -- agreements
c = at("entity",40,60) + at("agreement",440,60) \
  + at("agreement_period",840,60) + at("agreement_service",840,250) + at("site",440,400)
c += [edge("e50","entity","agreement","signed"),
      edge("e54","agreement","agreement_service","names what it covers"),
      edge("e52","agreement","agreement_period","one per interval"),
      edge("e53","site","agreement","may be for",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1"))]
c += [note("n6", "With site_id empty the agreement is the client's; with it set, it is "
                 "that site's and comes first for work there. A client may hold one of "
                 "its own, one per site, or both. Of two for the same place, the one "
                 "that started later covers an hour, so a renewal takes over from its "
                 "first day; two starting the same day may not cover the same service, "
                 "which would leave nothing to choose between them.\n\n"
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
files.append(write("06-agreements.drawio", "Agreements", c, 1620, 1060))

# 07 -- money out
c = at("invoice",40,60) + at("invoice_line",440,60) + at("credit_note",880,60) \
  + at("credit_application",880,300) + at("entity",40,430) + at("site",440,800) \
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
c += [note("n7", "A tax override is stored per line, so one invoice can carry lines at "
                 "two sites; setting it across an invoice writes the column many times.\n\n"
                 "Sending dates an invoice, gives it its due date and public_token: the "
                 "link a client opens it by, without signing in, shared from the phone. "
                 "Paid is not a status but the balance: what is owed, less payments and "
                 "credit notes, coming to nothing. Emailing an invoice, printing it as a "
                 "PDF and taking payment through Stripe are planned.\n\n"
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
                 "the quantity counts nothing, as on a flat charge or an adjustment. "
                 "A taxed line at a site keeps that site’s CDTFA area the same way, and "
                 "the state’s and districts’ shares where its rate is the site’s, so "
                 "Schedule A reads a period as it was billed.\n\n"
                 "What is bought for a job, or paid on the client's behalf, is a line of "
                 "its own kind: from whom, who paid -- a person, who is owed it back, or "
                 "the business -- and its receipt.\n\n"
                 "A line added by hand is saved on the phone first and sent when there "
                 "is a signal; client_uuid, made on the phone, keeps a retry from adding "
                 "it twice. A draft started there takes its number when it arrives. A "
                 "line meant for a draft that went out first starts a new draft for the "
                 "client, and moved_from_invoice_id keeps which it was meant for. A change "
                 "made on a phone says which version it began from, and one made "
                 "meanwhile is merged with it field by field.", 880, 480, 640, 330)]
files.append(write("07-money-out.drawio", "Money out", c, 1600, 1400))

# 08 -- money in
c = at("payment",40,60) + at("payment_allocation",440,60) + at("refund",440,220) \
  + at("payout",40,300) + at("invoice",840,60)
c += [edge("e70","payment","payment_allocation","is split across"),
      edge("e71","payment","refund","may be reversed by"),
      edge("e72","payout","payment","arrives as",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1")),
      edge("e73","invoice","payment_allocation","is settled by",
           S_EDGE.replace("exitX=1","exitX=0").replace("entryX=0","entryX=1"))]
c += [note("n8", "Stripe pays one deposit covering several invoices, net of "
                 "fees, so a payment knows which payout carried it and the payout knows "
                 "what the bank shows.\n\n"
                 "payment_allocation carries partial payments, and it is why a "
                 "refund never makes an invoice look unpaid: the refund reverses the "
                 "payment, and the invoice is closed by a credit note against the entity.",
           440, 420, 660, 170)]
files.append(write("08-money-in.drawio", "Money in", c, 1260, 620))

# 09 -- pay, as it was paid
c = at("person_payment",40,60) + at("person_payment_item",480,60) + at("user",40,330) \
  + at("time_entry",880,60) + at("trip",880,480)
c += [edge("e90","user","person_payment","is paid",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=0")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=1")),
      edge("e91","person_payment","person_payment_item","covers"),
      edge("e92","person_payment_item","time_entry","pays for",
           S_EDGE.replace("exitY=0.5","exitY=0.6").replace("entryY=0.5","entryY=0.3201")),
      edge("e93","person_payment_item","trip","its miles",
           S_EDGE.replace("exitY=0.5","exitY=0.75").replace("entryY=0.5","entryY=0.3"))]
c += [note("n9", "A payment to a person is recorded with what it covered: each item a time "
                 "entry, a trip -- its miles, paid to the owner of the vehicle it was driven "
                 "in -- or a correction to an earlier payment of theirs, plus or minus.\n\n"
                 "amount and said are what it came to that day and how: the hours and the "
                 "rule, in words, whatever the rules say later. A piece of work is paid to a "
                 "person once.\n\n"
                 "paid_as is what it paid: what the person's role said their pay was -- "
                 "guaranteed payments, wages or fees -- or, for a trip, a reimbursement, "
                 "whatever their role. A correction says which part of the earlier payment "
                 "it corrects.\n\n"
                 "Neither table changes once written; a correction is an item on the next "
                 "payment. reckon records a payment, and the money moves at the bank.",
           40, 800, 1176, 220)]
files.append(write("09-pay.drawio", "Pay, as it was paid", c, 1260, 1060))

# 10 -- people, and signing in
c = at("session",40,60) + at("account",40,320) + at("security_event",40,690) \
  + at("user",440,60) + at("email_message",440,480) \
  + at("passkey",840,60) + at("email_link",840,420) \
  + at("verification",1240,60) + at("link_try",1240,260) + at("rate_limit",1240,420)
c += [edge("e100","user","session","is signed in by",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0;exitY=0.2")
                 .replace("entryX=0","entryX=1")),
      edge("e101","user","account","is Better Auth's",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0;exitY=0.5")
                 .replace("entryX=0","entryX=1")),
      edge("e102","user","security_event","is in",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0;exitY=0.8")
                 .replace("entryX=0","entryX=1")),
      edge("e103","user","passkey","signs in with"),
      edge("e104","user","email_link","is sent"),
      edge("e105","user","email_message","is told by",
           S_EDGE.replace("exitX=1;exitY=0.5","exitX=0.5;exitY=1")
                 .replace("entryX=0;entryY=0.5","entryX=0.5;entryY=0"))]
c += [note("n10", "What someone can reach is user.access, apart from role_id, the "
                  "capacity they are paid in, which pay rules are written against. Full "
                  "is everything, and the only level that bills or pays; Field is their "
                  "own work and what they are paid for it. Someone new starts with "
                  "Field, and a trigger keeps someone active on Full. Which routes each "
                  "level reaches is the app's, in src/lib/access.ts.\n\n"
                  "Each person keeps a time zone, a locale, a clock and a first day of the "
                  "week. Empty follows the business's -- its own timezone and locale -- or "
                  "what the locale says.\n\n"
                  "Signing in is with a passkey and nothing else: a key pair made on "
                  "someone's phone, computer or security key, of which only the public "
                  "half is here. There are no passwords. user, session, account and "
                  "verification are Better Auth's, in its shape; account can hold no "
                  "password, and verification keeps the challenge of each passkey being "
                  "made or signing in until it is answered or lapses.\n\n"
                  "There is no sign-up: someone with Full adds people on Team, and the "
                  "first from the command line, and each is emailed a link to make their "
                  "first passkey. Someone who can't sign in is sent a link to make a new "
                  "one, which ends none of theirs. A link also confirms the address "
                  "someone signs in with, or makes a new one theirs, and using one proves "
                  "they read mail there: email_verified. An email_link is good once, for "
                  "an hour at most, and only while it still goes to the address its "
                  "person signs in with; its code is 256 random bits, of which only the "
                  "SHA-256 is kept. One of each kind waits at a time, and one used is "
                  "kept 90 days.\n\n"
                  "link_try is every code tried that was not one to use, by the network "
                  "it came from, so a network that keeps trying is turned away, and is "
                  "kept a day. rate_limit is Better Auth's count of requests to its own "
                  "routes, kept here so a restart forgives nothing.\n\n"
                  "A session is a row, not a stateless token: one server, one database, "
                  "and every page reads it anyway, so a stateless token would save no "
                  "round trip and cost revocation. The cookie is the token signed with "
                  "the server's secret, so a copy of this table lets nobody in without "
                  "the secret as well. It lasts until it has gone two weeks unused.\n\n"
                  "security_event is the security log: every sign-in, refused or not, "
                  "every passkey and link, everyone added or changed, every change of "
                  "access and every refusal for lack of it. The database stamps each "
                  "with its own clock, none is ever changed, and one is removed only "
                  "once it is a year old. Each person sees their own, and someone with "
                  "Full everyone's.\n\n"
                  "email_message is every email, written in the transaction that makes "
                  "the change it tells of, so it is sent if and only if that change is "
                  "kept, and sent afterwards to the relay the environment names. One the "
                  "relay puts off is tried later each time until send_by; one it refuses "
                  "for good is given up on. body, and html beside it, are kept only while "
                  "it is still to send, and a row is deleted after 90 days. Someone is "
                  "told whenever a passkey of theirs is added or removed, or all of them "
                  "are ended, and whenever their name, their address or their access "
                  "changes, or they are made inactive or active again.",
           40, 950, 1540, 470)]
files.append(write("10-people-and-signing-in.drawio", "People, and signing in", c, 1620, 1460))

# 11 -- the operator and the record
c = at("operator",40,60) + at("account_map",440,60) + at("ledger_export",440,180) \
  + at("integration",440,400) + at("record_history",440,560)
c += [edge("e110","operator","account_map","maps")]
c += [note("n11", "Everything that identifies the business is the operator's to supply: "
                  "logo is nullable and the interface renders trading_name in its "
                  "place.\n\n"
                  "An included-hours figure is a client's, on their agreement, "
                  "and what is paid to whoever answers is a dated pay_rule.\n\n"
                  "record_history is append-only and exists to explain a figure,"
                  " not to police one. An invoice line is followed from its birth: what it "
                  "was when added, each field changed, and what it was when taken off. A "
                  "receipt is described rather than copied while its row holds it, and kept "
                  "whole once the history is the only place it is: replaced, or taken off "
                  "with its line. made_at is when a change was made on a phone, beside "
                  "changed_at, when it arrived, and xact is the save it was in, so a change "
                  "is read with what went with it.\n\n"
                  "Which migrations a database has seen is Kysely's record, in "
                  "kysely.kysely_migration, so bringing it up to date again applies only "
                  "what is new.",
           840, 60, 540, 420)]
files.append(write("11-operator-and-record.drawio", "The operator, and the record", c, 1420, 1000))

for f in files:
    print(f"  {f}")
print(f"\n{len(files)} files, {len(T)} tables")
