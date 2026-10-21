// Plain explanations for the headings and filter names on the dashboard. A "?" next to
// each shows its text on hover, keyboard focus or tap (see info() in charts.ts). The
// numbers' own definitions come from the metrics API (src/lib/metrics/definitions.ts);
// this file only covers names that aren't numbers.
export const TERMS: Record<string, string> = {
  // Page titles
  'Today': 'What needs you today, followed by how the shop is doing over the date range you pick.',
  'Overview': 'The headline numbers for the date range, each compared with the period just before it.',
  'Acquisition': 'How people found the shop (Instagram, Google, direct and so on) and which of those routes ended in an order.',
  'Products': 'How each bag is doing: how many people looked, how many added it to the cart and how many bought.',
  'Checkout': 'Where people stop between opening checkout and paying, and how often payments fail.',
  'Audience': 'Who visits and who buys: new or returning, device, city, and age and gender from Google Analytics.',
  'Retention': 'Whether people come back after their first visit, and whether they go on to buy.',
  'People': 'Everyone who has visited, one row each. Open a row to see everything that person did.',
  'Daily funnel': 'One column per day, one row per step. Each person is counted on the day they first reached that step.',
  'Orders & revenue': 'Live orders from Shopify and the money they bring in.',
  'Fulfilment & payments': 'Orders waiting to be shipped or still waiting for payment.',
  'Try at Home bookings': 'Bookings people made to try bags at home.',
  'Private Viewing bookings': 'Bookings people made for a private video viewing.',
  'Affiliates': 'Creators with their own link. Any India order that starts from the link is credited to them.',
  'Newsletter': 'Everyone who signed up from the site footer.',
  'Team access': 'Who else can open this dashboard, and what they can see.',
  // Today
  'Do today': 'A short list of people and orders worth acting on today. Each one has a WhatsApp button and a Done button.',
  'The shop': 'The same headline numbers as the Overview, for the date range you picked.',
  'Ready to buy': 'People most likely to buy soon: a bag in the cart, recent visits, a phone number given. Ranked by a score out of 100.',
  'Payment didn’t go through': 'People who tried to pay in the last 7 days and did not complete it, and have not ordered since.',
  'Bookings to confirm': 'Try at Home and Private Viewing bookings for today or tomorrow, or past ones with no result recorded yet.',
  'Wanted but sold out': 'Bags that people keep looking at while the colour or bag is sold out. A guide to what to restock.',
  // Panels
  'Which channels bring buyers': 'Each route into the shop, with the orders and sales it led to, not just the visits.',
  'Where people drop off': 'How many people reach each step on the way to an order, and what share of the step before carried on.',
  'Where buyers come from': 'Orders credited to the route the buyer used. You can credit the last visit before the order, or the very first visit.',
  'Bags: attention to orders': 'For each bag: views, time spent, add-to-cart rate, orders and sales.',
  'Checkout steps': 'People at each step of checkout, and what share of the step before carried on.',
  'New vs returning': 'New visitors have never been seen before this period. Returning visitors had visited earlier.',
  'Device': 'Phone, desktop or tablet, taken from the browser each visitor used.',
  'Do people come back?': 'Each row is a week of first-time visitors. The columns show how many came back, or bought, in the weeks after.',
  'Traffic by country': 'Visitors by country.',
  // People filters
  'Everyone': 'Every person, whatever they did.',
  'Returning': 'People who have visited more than once.',
  'Viewed': 'People who looked at a bag but did not add one to the cart.',
  'Cart': 'People with a bag in their cart who have not started to pay.',
  'At checkout': 'People who opened checkout.',
  'Gave phone': 'People who typed in a phone number, so you can contact them.',
  'Payment': 'People who reached the payment step.',
  'Ordered': 'People with an order.',
};
