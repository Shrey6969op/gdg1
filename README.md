# QueueEase — Smart Queue & Appointment Manager

QueueEase is a general-purpose, real-time digital queue and appointment management platform. Service providers—such as clinics, therapists, HR desks, banks, salons, and government offices—can spin up a live queue in seconds, while customers join remotely, track live wait-time estimates, and receive multi-channel alerts as their turn approaches.

Zero external accounts, API keys, or cloud databases are required. Everything runs locally out of the box.

---

## Key Features

- **Dynamic Priority & Aging Engine:** Automatically sorts `WAITING` tokens by priority rank, arrival/scheduled time, and a configurable aging mechanism that prevents low-priority customers from waiting indefinitely—while ensuring Emergency (Rank 1) tokens are never overtaken.
- **Live Wait-Time Estimation:** Calculates rolling average service times from the last 10 completed tokens (filtering outliers >3x default), factoring in active counters and busy slots to display a ±25% time range and expected clock time.
- **Appointments & Walk-Ins:** Supports 15-minute appointment slots up to 7 days ahead. On-time check-ins retain their scheduled slot priority; late arrivals (>15 min) fall back to check-in time.
- **Real-Time Updates with Fallback:** Powered by Socket.IO rooms (`facility:{id}` and `token:{id}`) with an automatic 10-second polling fallback and live connection status indicator.
- **Multi-Channel Notifications:** In-app banners, toasts, Web Audio API synthesized beeps (no audio files), `navigator.vibrate`, Browser Notification API, and blinking page titles (`(!) Your turn`).
- **Automated No-Show Handling:** Background job checks grace-period expiry every 15 seconds after a second recall, auto-marking `NO_SHOW` and allowing a one-time daily rejoin.
- **Three Dedicated Views:** Mobile-first Customer flow, PIN-protected Staff Dashboard (with a 5-customer simulator), and a fullscreen TV-style Public Display Board.

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React, Vite, React Router, Plain CSS (mobile-first), `qrcode.react` |
| **Backend** | Node.js, Express |
| **Database** | SQLite via `better-sqlite3` (auto-initializes schema on startup) |
| **Realtime** | Socket.IO (+ 10-second client polling fallback) |
| **Testing** | Node.js built-in test runner (`node:test`) |
| **Dev Tooling** | Monorepo (`/client` & `/server`) orchestrated with `concurrently` |

---

## Project Structure

```text
queue-ease/
├── package.json              # Root scripts (dev, seed, test)
├── server/
│   ├── index.js              # Express app, Socket.IO setup, background no-show job
│   ├── db.js                 # SQLite connection & auto-schema creation
│   ├── queueEngine.js        # Pure, unit-tested priority & aging ordering engine
│   ├── waitEstimate.js       # Pure, unit-tested wait-time calculation function
│   ├── notify.js             # Socket.IO notification dispatcher + SMS/WhatsApp stub
│   ├── seed.js               # Demo data generator
│   └── tests/                # node:test unit tests
└── client/
    ├── vite.config.js        # Proxy config for /api and /socket.io -> :4000
    └── src/
        ├── pages/            # Home, Create, Join, TokenStatus, StaffDashboard, DisplayBoard
        └── components/       # Banners, toasts, QR display, priority chips