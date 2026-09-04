# SignalOps Admin Portal

React/Vite administrator portal for the SignalOps notification platform. The portal now uses the standalone SignalOps API; operational data is no longer stored in browser localStorage.

## V1 capabilities

- Administrator login with access-token refresh and logout
- Invitation activation and secure OTP-based password recovery
- RDS-backed workspace overview, alerts, people, groups, departments, facilities, buildings, templates, roles, and settings
- Employee and portal-user invitations
- Custom role creation and permission assignment
- Organisation, facility, building, group, and individual alert targeting
- Immediate release or approval submission
- Alert approval, resolution, delivery summaries, acknowledgements, reminders, and assistance escalation
- SES, FCM, and future SMS channel configuration
- Netlify SPA routing for account activation and password recovery

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_API_BASE_URL` to the SignalOps API base URL.
3. Run `npm install` and `npm run dev`.

```env
VITE_API_BASE_URL=http://localhost:5002/api/v1
```

Open `http://localhost:5173` and sign in with an active portal account.

## Production configuration

Set `VITE_API_BASE_URL=https://your-api-host/api/v1` in Netlify before building. The backend must allow the deployed frontend origin through `CORS_ORIGINS`.

For a frontend and API hosted on different sites, configure the backend with:

```env
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

Provider secrets stay in the backend environment and must never be added as `VITE_` variables.

## Build verification

```bash
npm run build
```

Functional and end-to-end verification belongs to Phase 4.
