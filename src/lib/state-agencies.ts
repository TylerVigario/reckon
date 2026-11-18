import type { State } from './us-states.ts';

/**
 * WHERE A STATE PUBLISHES ITS RATES, for a person typing its areas in and
 * choosing a site's (#lib/server/typed-areas): the agency a seller files with,
 * its page listing each jurisdiction's rate, and its tool that says which
 * apply at an address, where it has one -- the agency's own, as its own site
 * links it, wherever it is hosted, and never a tax vendor's lookup service.
 * Alaska has no state agency: its local taxes are the cities' and boroughs',
 * and the Alaska Remote Seller Sales Tax Commission lists its members' rates.
 * Each was read on the agency's own site in November 2026.
 *
 * A link, never a copy: the state's page is what is true, and a rate is typed
 * from it and confirmed against it each quarter. Where a state has no address
 * lookup, its page of rates is where a site's area is looked for (whereToLook).
 */
export type Agency = {
	/** The agency's own name for itself. */
	name: string;
	/** As a sentence names it the second time: the Comptroller. */
	short: string;
	/** Its page of rates by jurisdiction. */
	rates: `https://${string}`;
	/** Its address lookup, where it has one. */
	lookup: `https://${string}` | null;
};

export const AGENCY: Partial<Record<State, Agency>> = {
	AL: {
		name: 'Alabama Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://www.revenue.alabama.gov/sales-use/tax-rates/',
		lookup: 'https://www.alabamainteractive.org/ador_taxrate_lookup/welcome.action'
	},
	AK: {
		name: 'Alaska Remote Seller Sales Tax Commission',
		short: 'the Commission',
		rates: 'https://arsstc.org/business-sellers/member-jurisdictions/',
		lookup: null
	},
	AZ: {
		name: 'Arizona Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://azdor.gov/business/transaction-privilege-tax/tax-rate-table',
		lookup: 'https://www.aztaxes.gov/Home/Address/'
	},
	AR: {
		name: 'Arkansas Department of Finance and Administration',
		short: 'the Department',
		rates:
			'https://www.dfa.arkansas.gov/office/taxes/excise-tax-administration/sales-use-tax/sales-use-tax-rates/city-and-county-sales-use-tax-rates/',
		lookup:
			'https://www.dfa.arkansas.gov/office/taxes/excise-tax-administration/sales-use-tax/local-tax-lookup-tools/'
	},
	CO: {
		name: 'Colorado Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://tax.colorado.gov/DR1002',
		lookup: 'https://salestaxlookup.colorado.gov/'
	},
	CT: {
		name: 'Connecticut Department of Revenue Services',
		short: 'the Department',
		rates: 'https://portal.ct.gov/drs/sales-tax/tax-information',
		lookup: null
	},
	DC: {
		name: 'Office of Tax and Revenue',
		short: 'the Office of Tax and Revenue',
		rates: 'https://otr.cfo.dc.gov/page/taxable-and-non-taxable-services',
		lookup: null
	},
	FL: {
		name: 'Florida Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://pointmatch.floridarevenue.com/General/DiscretionarySalesSurtaxRates.aspx',
		lookup: 'https://pointmatch.floridarevenue.com/Default.aspx'
	},
	GA: {
		name: 'Georgia Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://dor.georgia.gov/sales-tax-rates-general',
		lookup: null
	},
	HI: {
		name: 'Hawaii Department of Taxation',
		short: 'the Department of Taxation',
		rates: 'https://tax.hawaii.gov/geninfo/countysurcharge/',
		lookup: null
	},
	ID: {
		name: 'Idaho State Tax Commission',
		short: 'the Tax Commission',
		rates: 'https://tax.idaho.gov/taxes/sales-use/online-guide/',
		lookup: null
	},
	IL: {
		name: 'Illinois Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://tax.illinois.gov/research/taxrates.html',
		lookup: 'https://mytax.illinois.gov/?Link=TaxRateFinder'
	},
	IN: {
		name: 'Indiana Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://www.in.gov/dor/i-am-a/business-corp/sales-tax/',
		lookup: null
	},
	IA: {
		name: 'Iowa Department of Revenue',
		short: 'the Department of Revenue',
		rates:
			'https://revenue.iowa.gov/taxes/tax-guidance/sales-use-excise-tax/local-option-sales-tax-lost',
		lookup: 'https://tax-mapper.iowa.gov/TaxMapper/SalesTaxRate'
	},
	KS: {
		name: 'Kansas Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://www.ksrevenue.gov/salesratechanges.html',
		lookup: 'https://www.ksrevenue.gov/atrladdress.html'
	},
	KY: {
		name: 'Kentucky Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://revenue.ky.gov/Business/Sales-Use-Tax/Pages/default.aspx',
		lookup: null
	},
	LA: {
		name: 'Louisiana Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://remotesellersfiling.louisiana.gov/lookup/lookup.aspx',
		lookup: null
	},
	ME: {
		name: 'Maine Revenue Services',
		short: 'Maine Revenue Services',
		rates: 'https://www.maine.gov/revenue/taxes/sales-use-service-provider-tax/rates-due-dates',
		lookup: null
	},
	MD: {
		name: 'Comptroller of Maryland',
		short: 'the Comptroller',
		rates:
			'https://services.marylandcomptroller.gov/taxes/en/sales-and-use-tax?id=kb_article_view&sysparm_article=KB0010107',
		lookup: null
	},
	MA: {
		name: 'Massachusetts Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://www.mass.gov/guides/sales-and-use-tax',
		lookup: null
	},
	MI: {
		name: 'Michigan Department of Treasury',
		short: 'Treasury',
		rates: 'https://www.michigan.gov/taxes/business-taxes/sales-use-tax',
		lookup: null
	},
	MN: {
		name: 'Minnesota Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://www.revenue.state.mn.us/local-sales-tax-information',
		lookup: 'https://www.revenue.state.mn.us/sales-tax-rate-calculator'
	},
	MS: {
		name: 'Mississippi Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://www.dor.ms.gov/business/sales-use-tax/sales-tax-rates',
		lookup: null
	},
	MO: {
		name: 'Missouri Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://dor.mo.gov/taxation/business/tax-types/sales-use/rate-tables/',
		lookup: 'https://mytax.mo.gov/rptp/portal/home/business/customFindSalesUseTaxRates'
	},
	MT: {
		name: 'Montana Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://revenue.mt.gov/taxes/miscellaneous/local-resort-tax',
		lookup: null
	},
	NE: {
		name: 'Nebraska Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://revenue.nebraska.gov/businesses/local-sales-and-use-tax-rates',
		lookup: 'https://gis.ne.gov/rev/SalesTaxFinder'
	},
	NV: {
		name: 'Nevada Department of Taxation',
		short: 'the Department of Taxation',
		rates: 'https://tax.nv.gov/tax-types/sales-tax-use-tax/',
		lookup: null
	},
	NJ: {
		name: 'New Jersey Division of Taxation',
		short: 'the Division of Taxation',
		rates: 'https://www.nj.gov/treasury/taxation/businesses/salestax/index.shtml',
		lookup: null
	},
	NM: {
		name: 'New Mexico Taxation and Revenue Department',
		short: 'the Department',
		rates:
			'https://www.tax.newmexico.gov/governments/gross-receipts-location-code-and-tax-rate-map/',
		lookup: null
	},
	NY: {
		name: 'New York State Department of Taxation and Finance',
		short: 'the Tax Department',
		rates: 'https://www.tax.ny.gov/pubs_and_bulls/publications/sales/local_rates_current.htm',
		lookup: 'https://www8.tax.ny.gov/JRLA/jrlaStart'
	},
	NC: {
		name: 'North Carolina Department of Revenue',
		short: 'the Department of Revenue',
		rates:
			'https://www.ncdor.gov/taxes-forms/sales-and-use-tax/sales-and-use-tax-rates/current-sales-and-use-tax-rates',
		lookup: null
	},
	ND: {
		name: 'North Dakota Office of State Tax Commissioner',
		short: 'the Tax Commissioner',
		rates:
			'https://www.tax.nd.gov/sites/default/files/documents/guidelines/business/sales-use/local-taxes-by-location.pdf',
		lookup: 'https://tap.tax.nd.gov/?link=RateLookup'
	},
	OH: {
		name: 'Ohio Department of Taxation',
		short: 'the Department of Taxation',
		rates: 'https://tax.ohio.gov/business/sales-and-use-tax/rate-tables',
		lookup: 'https://thefinder.tax.ohio.gov/'
	},
	OK: {
		name: 'Oklahoma Tax Commission',
		short: 'the Tax Commission',
		rates: 'https://oklahoma.gov/tax/reporting-resources/publications.html?q=copo',
		lookup: 'https://taxproject.csa.ou.edu/Rate_Locator'
	},
	PA: {
		name: 'Pennsylvania Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://www.pa.gov/agencies/revenue/resources/tax-rates',
		lookup: null
	},
	RI: {
		name: 'Rhode Island Division of Taxation',
		short: 'the Division of Taxation',
		rates: 'https://tax.ri.gov/tax-sections/sales-excise-taxes/sales-use-tax',
		lookup: null
	},
	SC: {
		name: 'South Carolina Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://dor.sc.gov/sales-use-tax-index',
		lookup:
			'https://rfa.maps.arcgis.com/apps/instant/lookup/index.html?appid=689fd82b343045988251f0cbad8f1620'
	},
	SD: {
		name: 'South Dakota Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://dor.sd.gov/businesses/taxes/municipal-tax/',
		lookup:
			'https://sdgis.sd.gov/portal/apps/experiencebuilder/experience/?id=09f9b73eff74481fb2e12de719662b8f'
	},
	TN: {
		name: 'Tennessee Department of Revenue',
		short: 'the Department of Revenue',
		rates:
			'https://www.tn.gov/revenue/taxes/sales-and-use-tax/local-sales-tax/local-sales-tax-rates-map.html',
		lookup: 'https://tnmap.tn.gov/sst/sst.html'
	},
	TX: {
		name: 'Texas Comptroller of Public Accounts',
		short: 'the Comptroller',
		rates: 'https://comptroller.texas.gov/taxes/sales/city.php',
		lookup: 'https://gis.cpa.texas.gov/search/'
	},
	UT: {
		name: 'Utah State Tax Commission',
		short: 'the Tax Commission',
		rates: 'https://tax.utah.gov/business/sales-tax/sales/rates/',
		lookup: 'https://tap.tax.utah.gov/TaxExpress/_/'
	},
	VT: {
		name: 'Vermont Department of Taxes',
		short: 'the Department of Taxes',
		rates: 'https://tax.vermont.gov/business/local-option-tax',
		lookup: null
	},
	VA: {
		name: 'Virginia Department of Taxation',
		short: 'Virginia Tax',
		rates: 'https://www.tax.virginia.gov/retail-sales-and-use-tax',
		lookup: 'https://www.tax.virginia.gov/sales-tax-rate-and-locality-code-lookup'
	},
	WA: {
		name: 'Washington State Department of Revenue',
		short: 'the Department of Revenue',
		rates:
			'https://dor.wa.gov/taxes-rates/sales-use-tax-rates/local-sales-use-tax/local-sales-use-tax-rate-table',
		lookup: 'https://webgis.dor.wa.gov/taxratelookup/SalesTax.aspx'
	},
	WV: {
		name: 'West Virginia Tax Division',
		short: 'the Tax Division',
		rates:
			'https://tax.wv.gov/Business/SalesAndUseTax/MunicipalSalesAndUseTax/Pages/MunicipalSalesAndUseTax.aspx',
		lookup: null
	},
	WI: {
		name: 'Wisconsin Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://www.revenue.wi.gov/Pages/FAQS/pcs-taxrates.aspx',
		lookup: 'https://www.revenue.wi.gov/Pages/Apps/strb.aspx'
	},
	WY: {
		name: 'Wyoming Department of Revenue',
		short: 'the Department of Revenue',
		rates: 'https://excise-tax-div.wyo.gov/sales-use-tax-rate-charts',
		lookup: null
	}
};

/** Where a site's area is looked up: the state's lookup, or else its rates. */
export const whereToLook = (a: Agency) => a.lookup ?? a.rates;
