# STECHAD backend

## Seed the Super Admin

The system permits exactly one `super_admin`. After the database schema has been synchronized, set the four `SUPER_ADMIN_*` values shown in `.env.example`, then run:

```bash
npm run seed:super-admin
```

The command is idempotent for the same email and will refuse to create or promote another account when a Super Admin already exists. The password must be at least 12 characters.

## Browser location addresses

Set `GEOAPIFY_API_KEY` to enable server-side reverse geocoding. When a user grants browser location consent, the backend sends the coordinate to Geoapify and stores the returned city, state, country, and formatted address. The API key is never sent to the browser.
