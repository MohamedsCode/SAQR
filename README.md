<p align="center">
  <img src="shared/logo/saqr-logo.png" alt="SAQR صقر" width="150">
</p>

<p align="center"><b>We go after what scammers publish.</b><br>نلاحق ما ينشره المحتالون.</p>

<p align="center">
  <img src="docs/saqr-pitch.gif" alt="SAQR in 15 seconds" width="720">
</p>

## The problem

Scammers send texts and WhatsApp messages with links to fake websites that look like Abu Dhabi Police, TAMM,
Salik, Emirates Post or your bank. One tap on "Pay your fine" or "Release your parcel" and card details are gone.
Most people only find out after the money has left their account.

## Our solution

SAQR checks a link before you trust it. In a few seconds it tells you, in Arabic or English, whether the site is
safe, suspicious or a scam, and why. It also hunts for new scam sites and fake helpline numbers before anyone
reports them, and gives police ready-made evidence to take them down.

## How it works

- **Reads the link like an investigator:** look-alike names (`sa1ik`, `tamm.abudhabi.pay-fines.top`), brand-new
  domains, risky hosting, hidden redirects.
- **Opens the page safely** in an isolated browser and looks for card, password and one-time-code forms, and for
  copies of official sites.
- **An AI model trained on 17,877 real links** catches what the rules miss: 97.6% of its flags are correct and it
  finds 91.4% of phishing links on a held-out test set. Official UAE sites are never flagged.

We never listen to calls or read your messages. SAQR only looks at the links you choose to check.

## Install

### On a computer: SAQR for Chrome

Warns you before you type anything into a scam site.

1. **[Download SAQR-Chrome.zip](https://github.com/hankhali/Saqr/releases/latest/download/SAQR-Chrome.zip)** and
   extract it.
2. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the extracted `SAQR-Chrome` folder.

Done. SAQR checks every site you open, and only interrupts you when something is wrong.

### On a phone: no install needed

Open the SAQR website, paste the suspicious link or the whole message, and tap **Check**.

### Run it yourself

Needs Python 3.12 and Node.js 20+.

```bash
py -3.12 -m venv .venv && .venv\Scripts\activate      # macOS/Linux: python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && playwright install chromium
cd web && npm install && cd ..
npm run dev
```

Then open <http://localhost:5173/check> for the citizen page and <http://localhost:5173> for the police dashboard.
