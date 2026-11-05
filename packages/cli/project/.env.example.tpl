{{! rendered twice, from this one list: as ".env.example" with "example" set and every secret blank,
    and as ".env" with a secret of the project's own for each value marked as one }}
{{#example}}
# Every variable this application reads. Copy it to ".env" to run the app somewhere new.
#
# "zi new" already wrote a ".env" with a secret generated for each blank secret below and
# ENVIRONMENT=development, so this project runs as it stands. What is missing here is
# deliberate: a value published with the cli is a value everyone has.
{{/example}}
{{^example}}
# The secrets this application runs on, generated for this project. Git ignored.
#
# ".env.example" is the committed list of what a deployment has to set.
{{/example}}

# Where the application runs: "development" or "production". In development every mail is
# logged instead of sent, so a deployment names its own.
ENVIRONMENT={{^example}}development{{/example}}

# Where the application listens, and the url it hands out in links it generates.
PORT=3000
BASE_URL=http://localhost:3000

# The database this application stores everything in.
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=db

# Whether the connection to the database is encrypted. "true" anywhere the database is reached over a network.
DB_SSL=false

# Signs and verifies access and refresh tokens. Anyone holding these can mint a token
# for any user of this application, so they belong in a secret store rather than in a repository.
JWT_ACCESS_SECRET={{secret}}
JWT_REFRESH_SECRET={{secret}}

# Encrypts every encrypted column. Losing it loses that data, and leaking it reveals
# all of it - so rotating this one is a migration rather than an edit.
MASTER_KEY={{secret}}

# The first user, created on startup while the database holds none.
DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_PASSWORD={{secret}}

# Where a password reset link points, which is a page of your frontend rather than of this api.
CONFIRM_PASSWORD_RESET_URL=http://localhost:4200/confirm-password-reset

# The mail server outgoing email is sent through. Production does not start without one.
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
EMAIL_DEFAULT_SENDER=
