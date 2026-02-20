# Release Notes - v0.3.0 (oli-electron)

## Summary
This release focuses on significant improvements to the Content Steering user interface, enhanced player stability with the Shaka Player adapter, and the integration of core webapp version **0.12.0** features including the new AI Consultant.

## New Features
- **AI Integration (WebApp v0.12.0)**:
    - **🚀 AI Consultant Chat**: Full integration of the new AI-powered chat interface for data analysis and consultancy.
    - **✨ Data Augmentation**: Added a new toggle button to turn data augmentation on/off in the UI.
- **Player & Network**:
    - **Shaka Player Upgrade**: Updated Shaka Player to **version 5** (from version 4) for improved performance and features.
    - **Robust Path Resolving**: Significant work on path resolving logic to make it more robust with less room for errors.
    - **Cache Control**: Selective cache bypass for video assets to ensure real-time analysis is accurate.
    - **Traceroute**: Improved reset logic for network topology tracking.
    - **Direct Geolookup**: The Electron app now performs geolocation lookups directly from the client (bypassing the proxy) for improved accuracy and lower latency.
- **UI Enhancements**:
    - **Responsive 3-Column Layout**: Improved design and layout for the Content Steering view, optimized for better usability.
    - **App Version Visibility**: Included application version in the window title for easier identification.
    - **Map & Visualization**: Optimized map updates and improved `PathNavigator` focus preservation during stream transitions.

## Technical Improvements
- **Core Sync**: Synchronized the `app` submodule to version **0.12.0**, incorporating all recent webapp features and fixes.
- **Server-Side Updates**:
    - **CORS Improvements**: Updated server configurations to better support authorized requests and specific origin headers.
    - **Simulation Engine**: Refined the traffic simulation engine for more realistic, hierarchical viewer distribution.
- **Build Process**: Refined the build and packaging process for macOS (arm64).
- **Architecture**: Better separation and dynamic loading of Electron-specific modules to optimize the shared webapp bundle.

## Fixes
- Fixed UI blocking issues in specific scenarios.
- Resolved various TypeScript errors in the Shaka Player integration.
- **Traceroute Optimization**: Improved traceroute reliability, visualization deduplication, and geo-validation.
- **Network Pathing**: Fixed issues where the network path wasn't correctly recreated when switching streams.
- Fixed CORS errors when playing regular `.mp4` (VOD) files by using native playback.

## Known Issues
- **AI Context**: The AI Consultant is currently not aware when videos are being played from different CDN architectures.

## Distributables
- `oli CDN Demo-0.3.0-arm64.dmg`
- `oli CDN Demo-0.3.0-arm64-mac.zip`
