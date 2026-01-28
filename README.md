# o|i CDN Demo - Desktop App

A standalone desktop application for visualizing video streaming delivery paths and CDN performance.

![o|i CDN Demo](assets/oli_floppy.png)

## ⬇️ Download

**[Download the latest release](https://github.com/markminnoye/oli-electron/releases/latest)**

- **macOS (Apple Silicon)**: Download the `.dmg` file

> ⚠️ The app is not code-signed. On first launch, right-click → Open, or allow it in System Preferences → Security & Privacy.

## ✨ Features

### 🗺️ Network Path Visualization
- Real-time traceroute showing your video delivery path
- Geographic visualization of network hops on the map
- Click any hop to view details (location, latency, IP address)

### ⚖️ Scenario Bake-Off (Comparison View)
- Side-by-side performance analysis of multiple video streams
- Real-time QoE metrics Comparison (TTFB, RTT, Buffer Health)
- Compare global CDNs against local infrastructure

### 📊 Performance Monitoring
- Live video quality metrics (bitrate, resolution, buffer health)
- CDN response times and HTTP headers
- Time to First Frame (TTFF) tracking

### 🔓 No Browser Restrictions
- Direct access to CDN manifests and segments (no CORS)
- Full HTTP header capture
- Real network traceroute via native `mtr` integration

## 🚀 Getting Started

1. Download and install the app
2. Enter a video URL or choose a demo stream
3. Watch the network path animate on the map
4. Click path segments to explore hop details

## 🌐 Web Version

Try the web version at **[o-i-demo.vercel.app](https://o-i-demo.vercel.app)**

The desktop app provides additional capabilities not available in browsers due to security restrictions.

## 🛠️ For Developers

See [AI_README.md](AI_README.md) for:
- Project architecture
- Build instructions
- Git submodule workflow
- Development setup

## 📄 License

MIT
