# Oracle Cloud Always Free deployment

This deploys both bot services on one Oracle Cloud VM:

- `otbasy-instabot-model` listens only on `127.0.0.1:8080`.
- `otbasy-instabot-edge` listens on `127.0.0.1:3000`.
- Caddy exposes HTTPS and proxies public traffic to the edge service.

## 1. Create the Oracle VM

Create an Oracle Cloud Always Free Compute VM, preferably Ubuntu 22.04 or 24.04.

Recommended shape:

- Ampere A1 ARM with 1 OCPU / 6 GB RAM, or
- AMD Always Free shape if Ampere capacity is unavailable.

Open ingress ports in the VM security list / network security group:

- TCP `22` for SSH.
- TCP `80` and `443` for Caddy and HTTPS certificates.

## 2. Point a domain to the VM

Instagram webhooks require HTTPS. Create an `A` record such as:

```text
bot.example.com -> <Oracle VM public IPv4>
```

Wait until DNS resolves before starting Caddy.

## 3. Install the bot

SSH into the VM and run:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/nietalinsabyrzan-rgb/Sabr.git /opt/Sabr
sudo bash /opt/Sabr/instagram_bot/deploy/oracle/install.sh bot.example.com
```

Replace `bot.example.com` with your real domain.

## 4. Add secrets

Edit the model environment:

```bash
sudo nano /etc/otbasy-instabot/model.env
```

Set:

```text
OPENAI_API_KEY=...
```

Edit the edge environment:

```bash
sudo nano /etc/otbasy-instabot/edge.env
```

Set:

```text
IG_USER_ID=...
IG_ACCESS_TOKEN=...
IG_WEBHOOK_VERIFY_TOKEN=...
```

## 5. Start services

```bash
sudo systemctl restart otbasy-instabot-model otbasy-instabot-edge caddy
sudo systemctl status otbasy-instabot-model otbasy-instabot-edge caddy
```

Check health:

```bash
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:3000/healthz
curl https://bot.example.com/healthz
```

## 6. Connect Meta webhook

In the Meta app dashboard, set callback URL:

```text
https://bot.example.com/webhook
```

Use the same value from `IG_WEBHOOK_VERIFY_TOKEN` as the webhook verify token.

## Operations

View logs:

```bash
sudo journalctl -u otbasy-instabot-edge -f
sudo journalctl -u otbasy-instabot-model -f
```

Disable replies without shutting down the webhook:

```bash
sudo sed -i 's/^AUTO_REPLY_ENABLED=.*/AUTO_REPLY_ENABLED=false/' /etc/otbasy-instabot/edge.env
sudo systemctl restart otbasy-instabot-edge
```

Update from GitHub:

```bash
cd /opt/Sabr
sudo git pull --ff-only
cd "/opt/Sabr/instagram_bot/instabot fin"
sudo npm ci
sudo npm run build
sudo systemctl restart otbasy-instabot-model otbasy-instabot-edge
```
