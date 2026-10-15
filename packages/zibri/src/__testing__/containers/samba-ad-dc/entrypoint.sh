#!/bin/sh
# Provisions the domain ZIBRI.TEST with the administrator password in $ADMIN_PASSWORD, serves TLS with
# the key and certificate the test copied to /tls, and runs the domain controller in the foreground.
set -e

rm -f /etc/samba/smb.conf
samba-tool domain provision \
    --realm=ZIBRI.TEST \
    --domain=ZIBRI \
    --server-role=dc \
    --dns-backend=SAMBA_INTERNAL \
    --adminpass="$ADMIN_PASSWORD"

# the test's own certificate rather than the one samba makes up, so that the client checks it as it
# would any other
sed -i '/^\[global\]/a \
\ttls enabled = yes\
\ttls keyfile = /tls/key.pem\
\ttls certfile = /tls/cert.pem\
\ttls cafile = /tls/ca.pem' /etc/samba/smb.conf

echo 'zibri: domain provisioned'
exec samba --foreground --no-process-group --debug-stdout