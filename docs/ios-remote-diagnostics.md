# Remote iOS Diagnostics

## Current Keyless Configuration

Enter only IP:port in the LAN and/or Tailscale address fields and enable sending.
For example, 192.168.1.10:8765 or 100.90.80.70:8765. HTTP and /diagnostics are
added automatically. No access key, discovery or pairing is required. The
receiver rejects public-IP peers and accepts private IPv4/loopback only. This
is a network boundary, not device authentication: any permitted peer can submit
logs. Use Tailscale ACLs and firewall rules to restrict access; do not publish
the port on the internet. LAN HTTP remains unencrypted.

The token-based instructions below describe the previous version and no longer
apply; the receiver no longer prints or requires a token.

Start the receiver on the computer:

```sh
node scripts/diagnostics-receiver.mjs
```

It listens on port 8765 on all interfaces and prints a random access token.
Optional environment variables: SDA_DIAGNOSTICS_TOKEN, SDA_DIAGNOSTICS_PORT,
SDA_DIAGNOSTICS_BIND and SDA_DIAGNOSTICS_DIR. Logs are daily JSONL files under
artifacts/ios-remote-diagnostics by default. Stop the process to stop receiving.

In iOS Settings / Remote Diagnostics configure both addresses, for example:

- LAN: http://192.168.1.10:8765/diagnostics
- Tailscale: http://100.90.80.70:8765/diagnostics

Enter the receiver's token and enable sending. The LAN endpoint is tried first;
failure falls back to Tailscale. Only private IPv4 addresses, localhost and
Tailscale DNS names are accepted. IPv6 is not yet supported. HTTP is plaintext:
prefer Tailscale on untrusted networks; do not expose the receiver to the public
internet. A firewall rule may be required for the selected port. No firewall
changes are made automatically.

One snapshot per second contains whitelisted playback counters, pause/background
state, anonymous playback generation, render path, raw/filtered head quaternion,
sensor timestamps, error flags and recent event names. No audio, cover image,
song name, full path or arbitrary error text is uploaded. An outstanding request
blocks additional uploads; failed snapshots are dropped rather than queued.
Redirects are rejected. Sending is native, not part of the JS pose pipeline.

Sending is off after every app launch and must be explicitly enabled. Endpoint
and token settings are stored locally in application preferences. Disable
sending to cancel the active request. In-flight data already received cannot be
retracted. Background delivery is best effort under iOS audio execution rules,
not an independent keep-alive mechanism.

The app permits HTTP via ATS for these endpoints; native destination validation
restricts this diagnostic sender. No receiver is automatically launched by the
application or the CI workflow.
