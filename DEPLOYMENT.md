# Eximius QR Quiz System — deployment preparation

## Before publishing
- This package adds a session-based admin login and protects admin management endpoints.
- Set `SECRET_KEY`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` as private environment variables on the hosting provider. Use a unique password and never commit `.env`.
- `render.yaml` configures a Render web service and a persistent disk mounted at `/var/data`. Persistent disks may require a paid plan.
- The included database is the project's current sample/test database. Check the questions and settings before the live event.

## Deploy on Render
1. Create a **private** GitHub repository and upload the contents of this folder (the files inside `QR QIUZ GAME`, not the parent folder).
2. In Render, choose **New → Blueprint** and connect the private repository.
3. Review `render.yaml`. Render should ask for `ADMIN_USERNAME` and `ADMIN_PASSWORD`; set both privately. Replace `SECRET_KEY` with a generated secret if the platform does not generate it automatically.
4. Deploy and wait for the service to become healthy.
5. Open `/admin/login` on the generated HTTPS URL and test the admin login.
6. Test visitor registration, team creation, quiz submission, live updates, and export using dummy records before the exhibition.
7. Generate new QR codes using the public HTTPS homepage URL, not a local IP address.

## Important limitations before a real event
- This app still uses a JSON file as its database. A persistent disk prevents normal redeploys from erasing the file, but JSON is not a robust concurrent database for many simultaneous visitors. For a busy public exhibition, migrate reads/writes to PostgreSQL (or at minimum SQLite with transaction-safe access) before collecting real visitor data.
- Admin login should be tested thoroughly. Use strong credentials and restrict dashboard access to authorized staff. Add rate limiting and a formal security review before handling personal data at scale.
- Keep the GitHub repository private because the code includes internal quiz questions and operational details.
- No deployment has been performed automatically by this package; you must connect the repository and set environment variables in the hosting account.
