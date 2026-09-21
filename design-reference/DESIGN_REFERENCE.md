# Design reference: Amex Travel → Us and The World

The screenshots in `amex/` are from the American Express Travel iOS app. View
each one before building the screen it maps to. This document describes what
each screen does and how it translates to Us and The World, so the intent is
clear even where a screenshot is ambiguous.

We are borrowing structure, hierarchy, and polish, not Amex's brand. Never use
Amex's name, logo, blue, or copy.

## The design language

Amex feels like an app rather than a website because of a handful of
consistent decisions. Photography is dominant and runs edge to edge with no
side padding. Every editorial title set over or beside a photo is a serif;
every navigational title and section heading is a bold sans. Surfaces are a
near-black page with slightly lighter charcoal cards, never navy and never
bordered. Tappable things are either a full-width button, a text link in the
accent color, or a whole card. Nothing is decorated; hierarchy comes from size
and weight alone.

Two kinds of page header exist, and the distinction matters. The Inspiration
tab uses a small centered navigation title with a row of text tabs beneath it.
Every other tab (Wishlists, Book, Trips) and the Profile sheet uses a large,
left-aligned bold sans title, roughly 34 to 40px, with generous space above.
A profile icon sits top-right on every tab.

Section headings inside a page are bold sans around 24px, usually followed by
a one-line gray subtitle, then the content.

### Tokens for Us and The World

| Role | Amex | Us and The World |
|---|---|---|
| Page background | near-black | `#050813` (existing) |
| Card surface | charcoal gray | a charcoal lifted from the page, e.g. `#16192a` |
| Accent (links, active tab, icons) | blue | `#c084fc` (existing) |
| Primary button | dark navy fill, blue label | dark purple-tinted fill, `#c084fc` label |
| Editorial serif | proprietary serif | Playfair Display (existing) |
| UI sans | SF Pro | the existing system sans stack |

Card corners are large and soft: around 24 to 28px on the big image cards and
empty-state card, around 12 to 16px on small tiles and grouped list
containers.

Things to avoid even though they're common defaults: an arrow glyph appended
to link or button text, ALL-CAPS labels, and meta strings joined with middle
dots. Amex writes labels in sentence case ("Article", "Guide") and keeps
metadata on its own line.

## Tab bar

Four items across the bottom: icon above label. The active tab tints both icon
and label in the accent; inactive items are mid-gray. The bar is a slightly
lighter surface than the page, with a hairline border on top, and it pads
itself above the iOS home indicator. Amex's icons are filled and slightly
illustrative, not thin outlines, which is part of why the bar feels native.

Ours: Explore, Bucket List, Passport, Travel. On desktop (768px and up), the
same four destinations move into a top navigation bar. The current build hides
the tab bar on desktop with no replacement, which leaves three tabs
unreachable.

## Explore ← Amex Inspiration

`01-inspiration-articles.jpg`, `02-inspiration-guides.jpg`,
`03-inspiration-trends.jpg`, `08-articles-hero-variant.jpg`,
`09-editors-picks-carousel.jpg`

Amex's Inspiration tab has three text tabs (Articles, Guides, Trends) directly
under a centered title. The active tab is accent-colored with a thick accent
underline spanning its third of the width; inactive tabs are gray. There are no
pill-shaped segments here.

Articles and Guides share one layout. A full-bleed photo fills the top, around
16:10, edge to edge. Beneath it, on a charcoal band, sits a small bold sans
label ("Guide") on Guides only, then a large serif headline around 40px, a
byline in regular sans ("by Megan Murphy"), a two or three line excerpt that
truncates with an ellipsis, and "Continue Reading" as an accent text link.

Below that comes a section: bold heading ("Editor's Picks", "Featured Guides &
Itineraries"), a gray one-line subtitle, then a horizontal carousel. In
`09-editors-picks-carousel.jpg` the active card is centered at roughly 85% of
the screen width with the neighbouring cards peeking in on both sides. Each
card is tall with rounded corners: a photo filling the top two thirds, then a
charcoal footer with a bold sans type label ("Article") and a serif title.

Trends is a single near-full-screen poster image with a small dark pill in the
bottom corner holding a location pin and the place name ("Marrakech, Morocco").

For Us and The World, search is the landing experience and must stay the first
thing on the page. The Explore tab therefore opens with the existing search
hero (earth video, search bar, rotating tagline) in the slot where Amex puts
its centered title, and the text-tab strip sits directly beneath it.

Our three tabs map as follows. Featured replaces Articles: one lead
destination brief in the full-bleed hero layout, with the city as the serif
headline, the brief's "why go now" as the excerpt, and "Build this trip" as the
accent link, followed by an "Editor's picks" carousel of the remaining briefs
and a carousel of recently verified trips. Guides replaces Guides: a vertical
feed of full city briefs, each with its image, serif city name, highlights,
best months, price level, and collapsible sources. Trending replaces Trends:
the top cities from the briefs as full-bleed poster cards, one per city, each
with the location pill, swipeable.

Brief content comes from the `explore_briefs` table. Every claim in a brief
must trace to a cited source, and sources stay visible.

## Bucket List ← Amex Wishlists

`04-wishlists.jpg`

Large left-aligned title. With nothing saved, Amex shows one big rounded
charcoal card containing a centered illustration (a map pin with a heart
inside, over a soft shadow ellipse), a bold "Let's Get Started!", one centered
line of copy, and a full-width primary button with a plus-in-circle icon
("Create New Wishlist").

Beneath the card: a bold "Need inspiration?" heading, a gray subtitle, then a
carousel of tall photo cards that start flush with the left margin and let the
next card peek in on the right. Each card has a round dark heart button in its
top-right corner.

For Us and The World, the empty-state card works the same way with our own
illustration and "Create a bucket list". Once lists exist, show them as photo
cards (cover image from the first place in the list, list name, place count).
The inspiration carousel holds famous places and destinations drawn from the
briefs' highlights, and the heart adds a place to a list. A "Get inspired"
section at the very bottom links back to Explore.

## Passport ← Amex Book

`05-book.jpg`

Amex's Book tab has a large title, then three equal tiles in a row (Flights,
Hotels, Cars): charcoal, softly rounded, each with an accent line icon above a
gray label. Below them is one large full-width rounded image card, tall, with
text overlaid at the bottom over a gradient: a small icon and place name, a
large serif headline, and a one-line subtitle.

For Us and The World, the three tiles become stats from the traveler's own
entries: Countries, Cities, Photos. The large image card becomes their most
recent stamp. Below that is the passport book itself: one page per stamp,
swiped horizontally with scroll snapping so each swipe lands on a page. Each
page carries a stamp-style mark (place, country, and date in an inked,
bordered, slightly rotated treatment), the cover photo, and the note, with a
page indicator. Keep it a smooth native swipe rather than a heavy 3D
page-turn animation. A "View all" control switches to a grid.

## Travel ← Amex Trips

`06-trips.jpg`

Large title, then an iOS-style segmented control: a rounded gray track with
the selected segment as a lighter raised pill (Upcoming, Past, Cancelled).
The empty state is centered: an illustration (a calendar), one sentence, and
an accent text link rather than a button ("Find Your Inspiration").

For Us and The World, the segments are Planned, Watching, and Shared with me.
Trips appear as photo cards with the serif destination name, day count, and
verified date. Sharing is a core purpose of this tab, so each trip card has a
one-tap share action using the native share sheet.

## Profile ← Amex Profile

`07-profile.jpg` (account details blurred)

A full-screen sheet with an accent close icon top-right and a large "Profile"
title. Content is grouped under bold sans section headings. Each group is a
rounded charcoal container of rows; each row has a line icon, a label, and a
chevron, separated by inset hairline dividers.

For Us and The World, only include rows that do something: account (email and
sign out, or sign in), travel preferences from the intake panel with a clear
option, and install to home screen where the browser supports it.
