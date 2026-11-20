# QueueEase ⏳

> **Smart Queue & Appointment Manager**
> A general-purpose digital queuing platform for clinics, therapists, HR desks, banks, government offices, salons, and customer service counters.

---

## 1. Overview & Problem Solved
People waste hours physically waiting in cramped waiting rooms at clinics, therapist offices, HR desks, banks, and public offices. **QueueEase** turns physical lines into smart, dynamic digital queues:
- **Remote Join:** Customers scan a QR code or enter a 6-character code to take a digital token from their phone.
- **Dynamic Queue Reordering:** Uses arrival time, custom priority tiers, and **priority aging** to prevent starvation of low-priority customers while ensuring Emergency (Rank 1) customers always jump to the front.
- **Accurate Live Wait Times:** Rolling average calculated from real completed tokens today, factoring in busy vs. free counters and parallel capacity.
- **Omnichannel Turn Alerts:** WebAudio synthetic chimes (no audio files needed), `navigator.vibrate`, system browser notifications, in-app pulsating banners, and blinking page titles.
- **Public TV Display Board:** Fullscreen high-contrast live board with active counter bay status and next waiting list for waiting room monitors.
- **Zero Config & Local:** Runs completely locally using SQLite (`better-sqlite3`), Node.js, Express, Socket.IO, and React + Vite.

---

## 2. Tech Stack

- **Frontend:** React 18, React Router v6, plain mobile-first responsive CSS, Vite.
- **Backend:** Node.js, Express, Socket.IO for realtime WebSocket events.
- **Database:** SQLite via `better-sqlite3` (auto-creates tables and WAL journal mode on launch).
- **QR Codes:** `qrcode.react` (SVG QR generation).
- **Audio & Haptics:** Pure WebAudio oscillator synthesis (pleasant dual-tone chime) & `navigator.vibrate`.
- **Testing:** Built-in `node:test` and `node:assert/strict`.

---

## 3. Quick Start & Exact Run Commands

### Prerequisites
- Node.js (v18+ or v20+ recommended)
- npm

### Installation
From the project root:
```bash
# Install root, server, and client dependencies
npm install
```

### Seed Demo Facilities
Populate two realistic demo facilities (`DEMO01` City Clinic and `DEMO02` Mind Wellness Therapy) with 8 tokens across all priority levels:
```bash
npm run seed
```
> **Default Staff PIN:** `1234` for all demo facilities.

### Run Unit Tests
Execute the unit tests for Queue Ordering, Priority Aging, and Wait-Time Estimation:
```bash
npm test
```

### Start Development Server
Starts both the backend (port `4000`) and the Vite frontend (port `5173`) concurrently:
```bash
npm run dev
```
Open **[http://localhost:5173](http://localhost:5173)** in your browser.

---

## 4. Key Rules & Business Logic

### A. Dynamic Queue Ordering & Priority Aging
1. **Effective Rank Calculation:**
   $$\text{effective\_rank} = \text{priority.rank} - \left\lfloor \frac{\text{minutes\_waited}}{\text{aging\_minutes}} \right\rfloor$$
   - **Emergency (Rank 1) is inviolable:** Aging discounts never allow non-emergency tokens to drop below Rank 2. Emergency always stays #1.
   - **Anti-Starvation:** A Regular (Rank 4) customer waiting for a long time gradually advances to Rank 3, then Rank 2, moving ahead of newly arrived regular walk-ins.
   - When `aging_minutes = 0`, aging is disabled.
2. **Sort Hierarchy:**
   `effective_rank ASC` $\rightarrow$ `effective_time ASC` $\rightarrow$ `seq ASC`.
3. **Appointments:**
   - Pre-booked appointments hold `BOOKED` status until checked in.
   - Self check-in is enabled 15 minutes before the scheduled time.
   - On-time/early check-in preserves `effective_time = scheduled_time`, prioritizing them over walk-ins who arrived later.
   - Late check-in (>15 min late) assigns `effective_time = checkin_time`.

### B. Wait-Time Estimation
1. **Average Service Duration:**
   Rolling mean of the last 10 `COMPLETED` tokens today ($\text{completed\_at} - \text{started\_at}$). Durations $> 3\times$ default are filtered out as outliers. If fewer than 3 samples exist today, it uses `facility.default_service_minutes`.
2. **Capacity & Wait Batches:**
   - $a = \text{waiting tokens ahead}$
   - $\text{busy} = \text{tokens in CALLED or SERVING}$
   - $\text{free} = \max(0, \text{active\_counters} - \text{busy})$
   - If $a < \text{free}$: Wait is estimated at **0–2 min** (counter available immediately).
   - Otherwise:
     $$\text{wait} = \left\lceil \frac{a - \text{free} + 1}{\text{active\_counters}} \right\rceil \times \text{avg\_service\_minutes}$$
   - Displays a $\pm 25\%$ range (e.g. "about 12–18 min") alongside expected clock time. Shows "Queue paused" when paused.

### C. Automated No-Show & 1-per-Day Rejoin
- Staff calls a customer to a counter. They can recall up to 2 times (3 total calls).
- If `call_count >= 2` and `now - called_at > facility.no_show_grace_minutes`:
  The background server job (running every 15s) automatically transitions the token to `NO_SHOW` and sends a notification.
- A `NO_SHOW` customer sees a **"Rejoin queue"** button, permitted once per day. This generates a fresh token with `effective_time = now` preserving their original priority category.

### D. Duplicate Phone Protection
- Multiple active tokens (`BOOKED`, `WAITING`, `CALLED`, `SERVING`) for the same phone number at the same facility are strictly rejected with HTTP 409.

---

## 5. Application Screens

| Screen | Route | Description |
| :--- | :--- | :--- |
| **Home** | `/` | Directory of active facilities, 6-character code input, demo facility shortcuts, and "Create My Queue" CTA. |
| **Create Facility** | `/create` | Setup form for name, facility type, active counters, service minutes, 4-digit PIN, and priority categories. Displays generated code & QR code on success. |
| **Join Queue** | `/join/:code` | Live queue length and wait estimate preview before joining, walk-in vs. appointment toggle (15-min slots for next 7 days), priority selection with verification notices, notification threshold selector. |
| **Token Status** | `/token/:id` | Live digital ticket with display number (e.g. `E-001`), queue position, dynamic wait range, "Now Serving" strip across counters, check-in for appointments, rejoin button for no-shows, and urgent banner when called. |
| **Staff Dashboard** | `/staff/:code` | Protected by 4-digit PIN. Realtime stats, counter bay cards with Call/Recall/Start/Complete/No-Show controls, ordered waiting list with 1-tap priority editor, pause/resume queue, simulate 5 customers, and day reset. |
| **TV Display Board** | `/display/:code` | Fullscreen-friendly dark-mode monitor display showing massive "Now Serving" numbers by counter with pulse animations, next 5 waiting list, clock, and audio chimes. |

---

## 6. Verification & Test Summary

The following test suites and end-to-end user journeys were executed and verified:
1. **Unit Tests (`npm test`):**
   - Inviolability of Emergency Rank 1 under extreme wait times (1000+ mins).
   - Stepwise priority aging discounts and floor at Rank 2.
   - Disabling aging when `aging_minutes = 0`.
   - Appointment check-in early/on-time vs. >15 min late time assignments.
   - Self check-in 15-minute eligibility window.
   - Dynamic sorting algorithm: verified that emergency customers jump to index 0 and long-waiting regular customers age up.
   - Wait-time estimation logic: outlier duration rejection, zero-wait free counter logic, and batch calculation with $\pm 25\%$ range.
2. **Facility Creation Flow:**
   - Created facility with custom counters and PIN. Verified 6-char unique code generation and QR code rendering.
3. **Customer Ingestion & Priority Ordering:**
   - Ingested 5 customers in sequence: Regular walk-ins, Senior citizen, Appointment, and an Emergency customer who arrived last.
   - Verified that Emergency immediately positioned at **#1 in line** on both Staff Dashboard and Public TV Board.
4. **Counter Service Lifecycle:**
   - Called customer to Counter 1 $\rightarrow$ Status became `CALLED` with audio chime and in-app banner.
   - Transitioned `CALLED` $\rightarrow$ `SERVING` $\rightarrow$ `COMPLETED`. Verified rolling average service time recalculated automatically.
5. **No-Show & Rejoin Lifecycle:**
   - Called customer to Counter 2, recalled once, verified recall count.
   - Transitioned to `NO_SHOW`. Verified customer status page presented "Rejoin queue" button.
   - Triggered rejoin: verified old token marked `rejoined = 1` and new active token created with current arrival time.
6. **Queue Pause & Resume:**
   - Paused queue with reason: verified customer token status showed "Queue paused" with reason. Resumed queue and verified live wait estimation restored.
7. **Concurrency & Validation:**
   - Concurrency protection on `call-next` using SQLite transactions.
   - Phone duplicate check blocked second active ticket creation.
