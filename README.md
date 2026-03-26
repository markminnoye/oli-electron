# o|i Lab

> See your video delivery paths. Control it with AI.

[![Try Web Version](https://img.shields.io/badge/Try-Web%20Version-6366f1?style=for-the-badge)](https://o-i-demo.vercel.app)&nbsp;&nbsp;[![Download Desktop App](https://img.shields.io/badge/Download-Desktop%20App-0ea5e9?style=for-the-badge)](https://github.com/markminnoye/oli-electron/releases/latest)

<details>
<summary>Resolving the "App is damaged" error on macOS</summary>

Because this app is not signed with an Apple Developer certificate, macOS Gatekeeper may assign a quarantine attribute to the downloaded file. This results in an error message stating: **"o|i Lab is damaged and can't be opened. You should move it to the Trash."**

To bypass this security feature and allow the app to run, open a **Terminal** window and execute the following command after moving the app to your Applications folder:

```bash
xattr -cr "/Applications/oi-Lab.app"
```

_This command removes the `com.apple.quarantine` extended attribute, signaling to macOS that you trust the application._

</details>

---

<img src="assets/CleanShot%202026-03-26%20at%2022.28.56.png" width="45%" alt="Bake-Off — compare streams side-by-side in real time">&nbsp;<img src="assets/CleanShot%202026-03-26%20at%2018.27.26.png" width="45%" alt="Content Steering — Quortex Switch strategy with Quortex Copilot">

---

## 🧁 Bake-Off

Put your CDNs head-to-head. Load as many streams as you need and compare their performance side by side under identical conditions. Each stream shows a full picture: QoE metrics alongside CDN and network performance. Works with live, VOD, and low-latency streams.

## 🔀 Content Steering

Orchestrate your multi-CDN strategy in real time. See which CDN is serving each viewer segment, monitor live bandwidth and viewer distribution across your CDN pool, track health per CDN, and visualise your network delivery path on an interactive map. Designed to help you balance quality of service and cost across all your CDN providers simultaneously.

## 🤖 Quortex Copilot

The Quortex Copilot is a context-aware AI assistant with full knowledge of your live Quortex Switch setup. It monitors your delivery in real time, flags issues as they emerge, and proactively advises on how to optimise your strategy. When you're ready to act — or when the situation calls for it — it can make changes directly: rebalancing CDN traffic, adjusting your strategy for a specific region, or responding to a live incident. Ask a question or give an instruction — it handles the rest.

## 💻 Desktop App

The desktop app unlocks capabilities that aren't possible in a browser:

- Full HTTP header capture — no CORS restrictions
- Native traceroute for accurate network path analysis
- Smart geolocation with RTT validation

---

## 🛠️ For Developers & Agents

See [AGENTS.md](AGENTS.md) for architecture, IPC channels, build instructions, and submodule workflow.

---

MIT License · Developed for o|i by <a href="https://sonicrocket.be">Sonic Rocket <img src="assets/SonicRocket-V1-light.svg" height="30" alt="Sonic Rocket" style="vertical-align:middle"></a>
