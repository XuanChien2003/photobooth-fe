# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The studio administrator manages packages, frames, rooms, staff, settings, print jobs and image storage. Receptionists issue shooting codes, monitor rooms and printing, and open kiosks for active rooms. Customers scan the album QR code on their phones to view and download their photographs, framed photo and time-lapse video; choosing photographs, framing and printing happen at the kiosk.

## Product Purpose

Connect the reception desk, room kiosk and customer's personal album in one photobooth workflow. Keep frequent actions easy to find and usable on phones as well as the studio computer.

## Operating Context

Vietnamese interface. Desktop reception and camera kiosks; customers scan an album QR code on mobile. Camera images arrive through a selected local folder. Printed compositions use existing 10 × 15 cm sizing and print workflow.

## Capabilities and Constraints

- Existing React/Vite frontend and separate Node/MongoDB backend; visual redesign keeps API contracts and role permissions.
- Receptionists access overview, shooting codes, print queue and active rooms/kiosk setup. Administrative CRUD and financial information remain restricted.
- Individual images expire 24 hours after capture; actual expiration and storage measurements drive warnings.
- Kiosk photo filters and composition, album downloads, print submission and truthful print confirmation must continue working.
- Preserve the custom storage-assistant name and user-requested messages.

## Brand Commitments

Keep the supplied logo at `public/logo-m.jpg`: a brown script “M.” on cream (replaced the pink-on-chocolate monogram on 2026-10-22), cropped square around the letter so it reads at small sizes. Primary color must be brown; the user delegates the particular brown and requests a complete professional, readable redesign using Impeccable.

## Evidence on Hand

Existing application code, actual logo, user screenshots and repeatable browser fixtures. Fixtures contain synthetic customers and images; never treat their numbers as production claims.

## Product Principles

- Make the next meaningful action clear.
- Show photographs prominently while keeping controls readable.
- Keep role boundaries and live operational states honest.
- Use one consistent control language across desktop, phone and kiosk.
