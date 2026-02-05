# Smart Geolocation Architecture

## Overview
The Smart Geolocation system addresses the challenge of accurately geolocating network infrastructure, particularly Content Delivery Networks (CDNs). Standard IP geolocation databases often fail with Anycast IPs, returning generic country centers (e.g., "Kansas" for US locations) rather than the actual server location.

This system implements a **multi-source, validated resolution strategy** to ensure the network topology map reflects the user's real physical data path.

## Architecture

This diagram illustrates the data flow from network request to map visualization:

```mermaid
graph TD
    User([User]) -->|Interacts| CS[ContentSteering]
    
    subgraph "Electron Shell"
        subgraph "Main Process (Node.js)"
            Main[Electron Main]
            Tracer[System Traceroute]
        end

        subgraph "Renderer Process (Web App)"
            CS
            
            subgraph "Services"
                DPA[DeepPacketAnalyser]
                Bridge[ElectronBridge]
                Topo[ElectronTopologyService]
                Smart[SmartGeoResolver]
            end
        end
    end

    %% Data Flow
    Main -->|Traffic Headers| Bridge
    Bridge -->|Forward Headers| DPA
    DPA -->|Segment Info| CS
    
    %% Traceroute Flow
    Main -->|1. Detect Server IP| Bridge
    Bridge -->|2. Notify| CS
    Main -->|3. Auto-Execute| Tracer
    Tracer -->|4. ICMP Hops| Main
    Main -->|5. IPC: Results| Bridge
    Bridge -->|6. Hops Data| CS
    
    %% Topology Resolution
    CS -->|Update Topology| Topo
    Topo -->|Resolve Hops| Smart
    
    subgraph "Smart Resolution Strategy"
        direction TB
        Smart -->|Primary| Headers(HTTP Headers)
        Smart -->|Secondary| DNS(Reverse DNS)
        Smart -->|Fallback| IP(IP Geolocation)
        
        Headers -.->|Confidence High| Candidate
        DNS -.->|Confidence Medium| Candidate
        IP -.->|Confidence Low| Candidate
        
        Candidate -->|Verify| RTT[GeoLocationValidator]
    end
    
    RTT -->|Result Valid/Impossible| Topo
    Topo -->|Nodes| Map[GeoMap Visualization]
```

## Process Flow

This sequence diagram details the real-time interaction between the Video Player, Electron Main process, and the Geo Services.

```mermaid
sequenceDiagram
    participant Video as Video Player
    participant Main as Electron Main
    participant Bridge as ElectronBridge
    participant CS as ContentSteering
    participant DPA as DeepPacketAnalyser
    participant Topo as Topology Service

    Note over Video, Main: 1. Network Traffic Initiation
    Video->>Main: HTTP Request (Video Segment)
    
    par
        Note right of Main: Layer 1: Header Analysis
        Main->>Bridge: IPC: OnHttpHeaders
        Bridge->>DPA: Analyze Headers
        DPA->>CS: NetworkSegment (CDN/Location hint)
        CS->>Topo: Update Baseline Topology
    and
        Note right of Main: Layer 2: Network Path
        Main->>Bridge: IPC: OnServerIpResolved
        Bridge->>CS: Server IP Detected
        
        Note over Main: Auto-Traceroute Triggered
        Main->>Main: Exec Traceroute (ICMP)
        
        loop Progressive Hops of Traceroute
            Main->>Bridge: IPC: OnTracerouteHop
            Bridge->>CS: Hop Data
            CS->>Topo: Geolocate Hop (SmartGeo)
            Topo-->>CS: Geolocated Node
            CS->>CS: Visual Map Update
        end
        
        Main->>Bridge: IPC: OnTracerouteComplete
        Bridge->>CS: Final Result + RTT
    end
```

## Data Flow: Traceroute to Visualization

This diagram shows how raw traceroute hops are filtered, geolocated, and displayed in the UI:

```mermaid
graph TD
    A[TracerouteResult<br/>Raw Hops Array] --> B{ElectronTopologyService}
    
    B --> C[Geolocate All Hops<br/>SmartGeoResolver]
    
    C --> D{Filter Pipeline}
    
    D --> E1[Remove Private IPs<br/>192.168.x, 10.x]
    E1 --> E2[Remove Timeouts<br/>No IP/hostname]
    E2 --> E3[Outlier Filter<br/>>2000km from path]
    
    E3 --> F[Valid Hops<br/>with IP + Location]
    D --> G[Unknown Hops<br/>null IPs]
    
    F --> H[NetworkPathState<br/>Calculate Gaps]
    G --> H
    
    H --> I{Gap Calculation}
    I --> J[gapsBeforeThis<br/>Unknown hops count]
    
    J --> K[GeoMap]
    J --> L[PathNavigator]
    
    K --> M[Line Segments<br/>+ Gap Badges]
    L --> N[Hop Counter<br/>Currently: 1/3, 2/3, 3/3]
    
    style F fill:#90EE90
    style G fill:#FFB6C1
    style N fill:#FFD700
    
    classDef highlight fill:#FFD700,stroke:#333,stroke-width:2px
    class N highlight
```

**Key Behaviors:**
- **GeoMap**: Shows all valid hops with gap indicators (e.g., "+2 unknown")
- **PathNavigator**: Currently displays position among *valid hops only* (1/3, 2/3, 3/3)
  - Each node stores `hopNumber` property with original traceroute hop number
  - Future enhancement: Display actual hop numbers (1/6, 4/6, 6/6) using `hopNumber` property

**Example Scenario:**
```
Traceroute Result: 6 total hops
├── Hop 1: User ISP (valid) ✅
├── Hop 2: * * * (timeout) ❌
├── Hop 3: * * * (timeout) ❌
├── Hop 4: Transit (valid) ✅
├── Hop 5: * * * (timeout) ❌
└── Hop 6: CDN Edge (valid) ✅

Current Navigator Display: 1/3 → 2/3 → 3/3
Proposed Enhancement: 1/6 → 4/6 → 6/6
```


## Core Components

### 1. SmartGeoResolver
**Role**: Central Intelligence  
**Location**: `src/services/geo/SmartGeoResolver.ts`

This service orchestrates the resolution process. It prioritizes data sources based on reliability:
1.  **HTTP Headers (High Confidence)**: CDNs often self-identify their location in debug headers using **IATA airport codes**.
    *   *AWS CloudFront*: `x-amz-cf-pop` (e.g., "AMS50" → **AMS** → Amsterdam)
    *   *Fastly*: `x-served-by` (e.g., "cache-fra..." → **FRA** → Frankfurt)
    *   *Cloudflare*: `cf-ray` (e.g., "...-LHR" → **LHR** → London)
2.  **Reverse DNS (Medium Confidence)**: Hostnames from traceroute often contain airport codes.
    *   Example: `ae1.3510.ear3.Frankfurt1.level3.net`
3.  **IP Geolocation (Low Confidence)**: Traditional database lookup (MaxMind/IP-API). Used as a baseline fallback.

### 2. GeoLocationValidator (RTT Check)
**Role**: Physics Enforcement  
**Location**: `src/services/geo/GeoLocationValidator.ts`

This component uses the "Speed of Light" constraint to validate locations.
*   **Input**: User Location, Target Location, Measured RTT (Round Trip Time).
*   **Logic**: Calculate the minimum time required for light to travel User→Target→User.
*   **Rule**: If `Measured RTT < Theoretical Min RTT`, the location is **Physically Impossible** and flag is raised.

### 3. DeepPacketAnalyser
**Role**: Header Extraction  
**Location**: `src/services/DeepPacketAnalyser.ts`

Extensions were made to this existing service to parse geolocating headers (`x-amz-cf-pop`, `x-id-shield`, `x-served-by`) from encrypted traffic streams and pass them to the topology engine.

### 4. ElectronTopologyService
**Role**: Topology Builder  
**Location**: `src/services/ElectronTopologyService.ts`

This service constructs the visual graph. It integrates `SmartGeoResolver` result and applies a final **Outlier Filter**:
*   Filters out hops that are >2000km away from both the User AND the Destination (common symptom of Anycast misrouting).

## Debugging

To verify geolocation logic, open the Electron Developer Console. You will see colored logs indicating the resolution source:

> `[SmartGeoResolver] ✅ MATCH (Source: Headers): Amsterdam (Code: AMS)`  
> `[SmartGeoResolver] ✅ MATCH (Source: DNS): Frankfurt (Hostname: ...fra...)`  
> `[SmartGeoResolver] 🟢 RTT VALID: Matches distance (150km)`  
> `[SmartGeoResolver] ⚠️ RTT MISMATCH: Impossible for 8.8.8.8`
