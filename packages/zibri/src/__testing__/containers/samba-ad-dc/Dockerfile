# An Active Directory domain controller for tests, from Debian's own samba package: there is no
# official samba image
FROM debian:stable-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends samba samba-ad-dc samba-ad-provision winbind \
    && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh

EXPOSE 389 636

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]