const priceFormatter = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 })
const dateFormatter = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' })
const listingDateFormatter = new Intl.DateTimeFormat('en-CA', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
})
const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export const formatPrice = (price: number) => (price === 0 ? 'Free' : priceFormatter.format(price))

export const formatDate = (timestamp: number) => dateFormatter.format(timestamp)

/** Date-only listing dates (matches Kijiji’s Posted / Expires style, no time). */
export const formatListingDate = (timestamp: number) => listingDateFormatter.format(timestamp)

export const formatDateTime = (timestamp: number) => dateTimeFormatter.format(timestamp)

/** Local calendar midnight for a timestamp. */
export const startOfLocalDay = (timestamp: number) => {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
