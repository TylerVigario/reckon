// How the tables reach each other, for Drizzle's relational queries. The
// foreign keys are the constraints; these are only the paths a query may walk.

import { relations } from 'drizzle-orm';
import { role, user } from './people.ts';
import { contact, entity, entityContact, site, siteContact, siteTaxCheck } from './clients.ts';
import {
	material,
	materialLot,
	materialPrice,
	payRule,
	service,
	servicePrice
} from './catalogue.ts';
import { timeEntry, trip, tripLeg, tripStop } from './work.ts';
import { agreement, agreementPeriod, agreementService } from './agreements.ts';
import { invoice, invoiceLine, payment, paymentAllocation, taxRemittance } from './money.ts';
import { recordHistory } from './operator.ts';

export const roleRelations = relations(role, ({ many }) => ({ users: many(user) }));

export const userRelations = relations(user, ({ one }) => ({
	role: one(role, { fields: [user.roleId], references: [role.id] })
}));

export const entityRelations = relations(entity, ({ many }) => ({
	sites: many(site),
	contacts: many(entityContact),
	agreements: many(agreement),
	invoices: many(invoice),
	payments: many(payment),
	timeEntries: many(timeEntry)
}));

export const contactRelations = relations(contact, ({ many }) => ({
	clients: many(entityContact),
	sites: many(siteContact)
}));

export const entityContactRelations = relations(entityContact, ({ one }) => ({
	entity: one(entity, { fields: [entityContact.entityId], references: [entity.id] }),
	contact: one(contact, { fields: [entityContact.contactId], references: [contact.id] })
}));

export const siteRelations = relations(site, ({ one, many }) => ({
	entity: one(entity, { fields: [site.entityId], references: [entity.id] }),
	contacts: many(siteContact),
	taxChecks: many(siteTaxCheck)
}));

export const siteContactRelations = relations(siteContact, ({ one }) => ({
	site: one(site, { fields: [siteContact.siteId], references: [site.id] }),
	contact: one(contact, { fields: [siteContact.contactId], references: [contact.id] })
}));

export const siteTaxCheckRelations = relations(siteTaxCheck, ({ one }) => ({
	site: one(site, { fields: [siteTaxCheck.siteId], references: [site.id] })
}));

export const serviceRelations = relations(service, ({ many }) => ({
	prices: many(servicePrice),
	payRules: many(payRule)
}));

export const servicePriceRelations = relations(servicePrice, ({ one }) => ({
	service: one(service, { fields: [servicePrice.serviceId], references: [service.id] }),
	entity: one(entity, { fields: [servicePrice.entityId], references: [entity.id] })
}));

export const payRuleRelations = relations(payRule, ({ one }) => ({
	service: one(service, { fields: [payRule.serviceId], references: [service.id] }),
	role: one(role, { fields: [payRule.roleId], references: [role.id] }),
	user: one(user, { fields: [payRule.userId], references: [user.id] }),
	entity: one(entity, { fields: [payRule.entityId], references: [entity.id] })
}));

export const materialRelations = relations(material, ({ many }) => ({
	lots: many(materialLot),
	prices: many(materialPrice)
}));

export const materialLotRelations = relations(materialLot, ({ one }) => ({
	material: one(material, { fields: [materialLot.materialId], references: [material.id] })
}));

export const materialPriceRelations = relations(materialPrice, ({ one }) => ({
	material: one(material, { fields: [materialPrice.materialId], references: [material.id] })
}));

export const timeEntryRelations = relations(timeEntry, ({ one }) => ({
	entity: one(entity, { fields: [timeEntry.entityId], references: [entity.id] }),
	site: one(site, { fields: [timeEntry.siteId], references: [site.id] }),
	service: one(service, { fields: [timeEntry.serviceId], references: [service.id] }),
	worker: one(user, {
		fields: [timeEntry.workedBy],
		references: [user.id],
		relationName: 'worked'
	}),
	author: one(user, {
		fields: [timeEntry.createdBy],
		references: [user.id],
		relationName: 'entered'
	})
}));

export const tripRelations = relations(trip, ({ one, many }) => ({
	driver: one(user, { fields: [trip.drivenBy], references: [user.id] }),
	stops: many(tripStop),
	legs: many(tripLeg)
}));

export const tripStopRelations = relations(tripStop, ({ one }) => ({
	trip: one(trip, { fields: [tripStop.tripId], references: [trip.id] }),
	site: one(site, { fields: [tripStop.siteId], references: [site.id] })
}));

export const tripLegRelations = relations(tripLeg, ({ one }) => ({
	trip: one(trip, { fields: [tripLeg.tripId], references: [trip.id] }),
	entity: one(entity, { fields: [tripLeg.entityId], references: [entity.id] }),
	site: one(site, { fields: [tripLeg.siteId], references: [site.id] }),
	service: one(service, { fields: [tripLeg.serviceId], references: [service.id] })
}));

export const agreementRelations = relations(agreement, ({ one, many }) => ({
	entity: one(entity, { fields: [agreement.entityId], references: [entity.id] }),
	site: one(site, { fields: [agreement.siteId], references: [site.id] }),
	contact: one(contact, { fields: [agreement.contactId], references: [contact.id] }),
	services: many(agreementService),
	periods: many(agreementPeriod)
}));

export const agreementServiceRelations = relations(agreementService, ({ one }) => ({
	agreement: one(agreement, { fields: [agreementService.agreementId], references: [agreement.id] }),
	service: one(service, { fields: [agreementService.serviceId], references: [service.id] })
}));

export const agreementPeriodRelations = relations(agreementPeriod, ({ one }) => ({
	agreement: one(agreement, { fields: [agreementPeriod.agreementId], references: [agreement.id] })
}));

export const invoiceRelations = relations(invoice, ({ one, many }) => ({
	entity: one(entity, { fields: [invoice.entityId], references: [entity.id] }),
	lines: many(invoiceLine),
	allocations: many(paymentAllocation)
}));

export const invoiceLineRelations = relations(invoiceLine, ({ one }) => ({
	invoice: one(invoice, { fields: [invoiceLine.invoiceId], references: [invoice.id] }),
	site: one(site, { fields: [invoiceLine.siteId], references: [site.id] }),
	timeEntry: one(timeEntry, { fields: [invoiceLine.timeEntryId], references: [timeEntry.id] }),
	tripLeg: one(tripLeg, { fields: [invoiceLine.tripLegId], references: [tripLeg.id] }),
	materialLot: one(materialLot, {
		fields: [invoiceLine.materialLotId],
		references: [materialLot.id]
	})
}));

export const paymentRelations = relations(payment, ({ one, many }) => ({
	entity: one(entity, { fields: [payment.entityId], references: [entity.id] }),
	allocations: many(paymentAllocation)
}));

export const paymentAllocationRelations = relations(paymentAllocation, ({ one }) => ({
	payment: one(payment, { fields: [paymentAllocation.paymentId], references: [payment.id] }),
	invoice: one(invoice, { fields: [paymentAllocation.invoiceId], references: [invoice.id] })
}));

export const taxRemittanceRelations = relations(taxRemittance, ({ one }) => ({
	author: one(user, { fields: [taxRemittance.createdBy], references: [user.id] })
}));

export const recordHistoryRelations = relations(recordHistory, ({ one }) => ({
	changedBy: one(user, { fields: [recordHistory.changedBy], references: [user.id] })
}));
