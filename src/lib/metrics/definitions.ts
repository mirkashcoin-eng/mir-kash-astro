// One written definition per number /admin shows. The hover text comes from here and
// nowhere else, and each line says what the SQL in db/migrations/002_metrics.sql
// actually counts. Change the SQL → change the sentence.
import type { Unit } from './types.ts';

export interface Definition {
  label: string;
  unit: Unit;
  definition: string;
}

const d = (label: string, unit: Unit, definition: string): Definition => ({ label, unit, definition });

// Shared wording.
const HUMAN = 'a person (once they have given a phone or email, across all their devices) or otherwise a browser';
const EXCL = 'Bots and test numbers are excluded unless switched on.';

export const DEFS = {
  // ── People and visits ──
  visitors: d('Visitors', 'count', `People who started at least one visit in the range — ${HUMAN}. ${EXCL}`),
  newVisitors: d('New visitors', 'count', 'Visitors seen for the very first time in the range (on any of their devices).'),
  returningVisitors: d('Returning visitors', 'count', 'Visitors who had been seen before the range started.'),
  returningVisitorShare: d('Returning visitors', 'rate', 'Visitors who had been seen before the range started ÷ all visitors in the range.'),
  sessions: d('Visits', 'count', `Visits that started in the range. A visit ends after 30 minutes without activity, or when someone arrives from a different ad or campaign. ${EXCL}`),
  engagedSessionRate: d('Engaged visits', 'rate', 'Visits with at least 10 seconds of engaged time or 2+ pages ÷ all visits.'),
  medianEngagedPerSession: d('Time per visit (median)', 'ms', 'Median engaged time per visit: time the tab was visible and the person had scrolled, clicked, typed or touched in the last 30 seconds, summed over the visit\'s pages. Visits whose pages never reported are left out.'),

  // ── Funnel steps (people) ──
  viewedProduct: d('Viewed a product', 'count', 'Visitors in the range who opened at least one product page in the range.'),
  addedToCart: d('Added to cart', 'count', 'Visitors in the range who added a bag to the cart in the range.'),
  startedCheckout: d('Started checkout', 'count', 'Visitors in the range who opened checkout in the range.'),
  startedPayment: d('Opened payment', 'count', 'Visitors in the range whose payment window opened in the range.'),
  ordered: d('Ordered', 'count', 'Visitors in the range who placed a live (not cancelled) order in the range, matched by phone/email.'),
  stepRate: d('From previous step', 'rate', 'People at this step ÷ people at the step before.'),

  // ── Money ──
  orders: d('Orders', 'count', 'Live Shopify orders (not cancelled) placed in the range, India and Global stores. Test numbers excluded unless switched on.'),
  revenue: d('Revenue', 'inr', 'Total of those orders in INR (Global orders converted at the rate on the day of the order), after discounts, including shipping and tax as Shopify reports it.'),
  medianOrderValue: d('Order value (median)', 'inr', 'Median order total in INR. Half the orders were worth more, half less.'),
  conversionRate: d('Conversion', 'rate', 'Visitors in the range who placed an order in the range ÷ all visitors in the range.'),

  // ── Acquisition ──
  leads: d('Leads', 'count', 'People who entered a phone number or submitted a Try at Home / Private Viewing booking, credited to the source of the visit they did it in.'),
  leadRate: d('Lead rate', 'rate', 'Leads ÷ visitors from this source.'),
  attributedOrdersLast: d('Orders', 'count', 'Live orders placed in the range, credited to the LAST visit the buyer made before ordering (any device linked to their phone/email). Orders we can\'t link to a visit show as "(unattributed)".'),
  attributedOrdersFirst: d('Orders', 'count', 'Live orders placed in the range, credited to the FIRST visit the buyer ever made (any device linked to their phone/email). Orders we can\'t link to a visit show as "(unattributed)".'),
  attributedRevenue: d('Revenue', 'inr', 'INR total of the orders credited to this row.'),
  channelConversion: d('Conversion', 'rate', 'Orders credited to this row ÷ visits from it.'),
  spend: d('Ad spend', 'inr', 'Meta / Google spend in the range for this campaign or ad (INR accounts only). Matched when the ad link\'s utm_campaign / utm_content is the campaign / ad name or ID.'),
  costPerSale: d('Cost per sale', 'inr', 'Ad spend ÷ orders credited to this campaign or ad.'),
  roas: d('ROAS', 'ratio', 'Revenue credited to this campaign or ad ÷ its ad spend. 3.0 = ₹3 back for every ₹1 spent.'),

  // ── Products ──
  productViews: d('Views', 'count', 'Times the product page was opened.'),
  productViewers: d('Viewers', 'count', 'People who opened the product page.'),
  productEngaged: d('Time on page (median)', 'ms', 'Median engaged time per view of this product page (tab visible and the person active in the last 30 seconds).'),
  galleryDepth: d('Photos seen (median)', 'count', 'Median number of different gallery photos shown or zoomed per view.'),
  scrollDepth: d('Scroll depth (median)', 'pct', 'Median of how far down the page each view scrolled, 0–100%.'),
  addToCartRate: d('Add to cart', 'rate', 'Viewers who added this bag to the cart from its page ÷ viewers.'),
  productOrders: d('Orders', 'count', 'Live orders that included this bag.'),
  units: d('Units', 'count', 'Units of this bag in live orders.'),
  productRevenue: d('Item revenue', 'inr', 'Units × list price in INR, before order-level discounts and shipping — so it won\'t add up exactly to order revenue.'),
  soldOutViews: d('Sold-out views', 'count', 'Views where the page showed a sold-out colour — demand we couldn\'t meet.'),

  // ── Checkout ──
  ckCart: d('Added to cart', 'count', 'People who added a bag to the cart.'),
  ckStart: d('Opened checkout', 'count', 'People who opened the checkout page.'),
  ckOtpSent: d('OTP sent', 'count', 'People who were sent a checkout OTP.'),
  ckOtpVerified: d('OTP verified', 'count', 'People who entered a correct OTP.'),
  ckPhone: d('Phone entered', 'count', 'People who entered a phone number on the checkout page (booking forms not included).'),
  ckAddress: d('Address entered', 'count', 'People who entered an address on the checkout page.'),
  ckMethod: d('Chose payment method', 'count', 'People who picked a payment method.'),
  ckPayment: d('Opened payment', 'count', 'People whose payment window opened.'),
  ckPaid: d('Payment succeeded', 'count', 'People whose payment went through (as the browser saw it).'),
  ckOrdered: d('Ordered', 'count', 'People with a live Shopify order placed in the range.'),
  otpFailureRate: d('OTP failures', 'rate', 'People who got an OTP wrong or expired ÷ people who were sent one.'),
  paymentFailureRate: d('Payment failures', 'rate', 'People whose payment failed ÷ people whose payment window opened.'),
  people: d('People', 'count', 'Different people.'),
  events: d('Times', 'count', 'Times it happened.'),
  share: d('Share', 'rate', 'This row ÷ the total.'),
  couponTries: d('Tries', 'count', 'Times the code was tried.'),
  couponValid: d('Accepted', 'count', 'Tries the code was accepted.'),
  couponInvalid: d('Refused', 'count', 'Tries the code was refused.'),

  // ── Audience ──
  audienceVisitors: d('Visitors', 'count', 'Visitors with at least one visit from this value in the range. Someone on two devices counts under both.'),
  audienceShare: d('Share', 'rate', 'Visitors with this value ÷ all visitors.'),
  audienceBuyers: d('Buyers', 'count', 'Of those visitors, people who placed a live order in the range.'),
  giftOrders: d('Likely gift orders', 'rate', 'Live orders in the range shipped to a different name or city than the buyer ÷ live orders where that could be judged. Inferred from the order; customers are never asked.'),
  audienceConversion: d('Conversion', 'rate', 'Buyers ÷ visitors with this value.'),
  gaUsers: d('Users (GA)', 'count', 'Google Analytics active users, added up over the days of the range (someone active on 3 days counts 3 times). GA is blocked for an estimated 15–30% of visitors, so it runs lower than our own counts.'),
  gaShare: d('Share (GA)', 'rate', 'This group\'s GA users ÷ GA users across all groups GA reported.'),
  gaSessions: d('Sessions (GA)', 'count', 'Google Analytics sessions over the range.'),
  gaConversions: d('Conversions (GA)', 'count', 'Google Analytics key events over the range.'),

  // ── Retention ──
  repeatPurchaseRate: d('Repeat buyers', 'rate', 'People who ordered in the range and had ordered before ÷ everyone who ordered in the range.'),
  medianDaysToFirstOrder: d('Days to first order (median)', 'days', 'For first-ever orders placed in the range: days from the buyer\'s first visit to the order.'),
  medianSessionsToFirstOrder: d('Visits to first order (median)', 'count', 'For first-ever orders placed in the range: visits the buyer made up to and including the one they ordered in.'),
  cohortActive: d('Came back', 'rate', 'People in the cohort with a visit in that week ÷ cohort size. Week 0 is the week they were first seen.'),
  cohortBuyers: d('Bought', 'rate', 'People in the cohort who placed a live order in that week ÷ cohort size.'),

  // ── Daily funnel (per IST day) ──
  fdVisitors: d('Visitors', 'count', 'People who started a visit that day. Not additive: someone who came on 3 days counts on each.'),
  fdNewVisitors: d('New', 'count', 'Visitors seen for the very first time that day. On days before the event log, the old counter\'s "visitors" (a first visit).'),
  fdReturning: d('Returning', 'count', 'Visitors that day who had been seen on an earlier day.'),
  fdSessions: d('Visits', 'count', 'Visits that started that day. On days before the event log, the old once-per-tab "visit" counter.'),
  fdP1: d('1st product', 'count', 'People who viewed their first product ever that day.'),
  fdP2: d('2nd product', 'count', 'People who viewed their second different product ever that day.'),
  fdP3: d('3rd product', 'count', 'People who viewed their third different product ever that day.'),
  fdCart: d('Cart', 'count', 'People who added to cart for the first time ever that day.'),
  fdCheckout: d('Checkout', 'count', 'People who opened checkout for the first time ever that day.'),
  fdPhone: d('Phone', 'count', 'People who gave a phone number for the first time ever that day (checkout, booking forms or the cart panel).'),
  fdAddress: d('Address', 'count', 'People who entered an address for the first time ever that day.'),
  fdPayment: d('Payment', 'count', 'People whose payment window opened for the first time ever that day.'),
  fdOrders: d('Orders', 'count', 'Live orders placed that day.'),
  fdRevenue: d('Revenue', 'inr', 'INR total of live orders placed that day.'),

  // ── Tracking health ──
  healthEvents: d('Events received', 'count', 'Events stored in the range (duplicates are dropped on arrival, so each counts once). Includes bots.'),
  healthRejectRate: d('Rejected', 'rate', 'Payloads refused by the collector ÷ (events stored + refused). Should stay near 0.'),
  healthBotShare: d('Bot share', 'rate', 'Events from crawlers ÷ all events stored.'),
  healthNoPageViews: d('Days with no page views', 'count', 'Days in the range when not a single page view arrived — the tracker was probably broken.'),
  healthRejects: d('Refused', 'count', 'Payloads the collector refused, by reason.'),
} as const satisfies Record<string, Definition>;

export type DefKey = keyof typeof DEFS;
