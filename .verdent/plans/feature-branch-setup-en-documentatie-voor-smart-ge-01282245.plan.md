# Feature Branch en Documentatie Setup

## Doel
Aanmaken van matching feature branches in beide repositories en de vereiste documentatie volgens het project protocol voordat implementatie begint.

---

## Stap 1: Feature Branch Aanmaken in Submodule (app/)

**Locatie**: `app/` (o-i-demo submodule)

**Commando's**:
```bash
cd app
git checkout develop
git pull origin develop
git checkout -b feature/smart-geolocation
```

---

## Stap 2: Feature Branch Aanmaken in Main Repo (oli-electron)

**Locatie**: Root (`oli-electron/`)

**Commando's**:
```bash
cd /Users/markminnoye/git/oli-electron
git checkout develop
git pull origin develop
git checkout -b feature/smart-geolocation
```

---

## Stap 3: Feature Documentatie Aanmaken

**Bestand**: `app/docs/features/smart-geolocation.md` (NIEUW)

**Inhoud** (gebaseerd op template.md):

```markdown
# Smart Geolocation

## Overview
Verbeterde geolocation voor traceroute hops en CDN endpoints door:
- RTT-based validatie om fysiek onmogelijke locaties te detecteren
- Multi-source fallback: HTTP headers → Reverse DNS → IP Geolocation
- Shared codebase voor Electron (volledige capabilities) en webapp (beperkt door CORS)

Lost het probleem op: "MaxMind/ip-api retourneert verkeerde locaties voor CDN anycast IP's"

## Requirements
**Backlog Link**: Known Bug "MaxMind vs CDN Header Location Mismatch" in ROADMAP.md

- [ ] RTT-validatie service die fysiek onmogelijke geolocaties detecteert
- [ ] Multi-source resolver met fallback chain (headers → DNS → IP lookup)
- [ ] Confidence score per geolocatie resultaat
- [ ] Integratie in ElectronTopologyService
- [ ] Backward-compatible voor webapp (geen regressie)
- [ ] UI indicator voor low-confidence locaties (optioneel)

## Research & Learnings

### Probleem Analyse
- **Anycast IP's**: CDN's gebruiken dezelfde IP vanuit meerdere locaties wereldwijd
- **Geolocation databases**: Slaan slechts één locatie per IP op (vaak HQ of primary DC)
- **Voorbeeld**: Fastly IP `151.101.1.57` bedient vanuit 50+ locaties, maar MaxMind retourneert alleen "San Francisco"

### Oplossingsrichtingen Overwogen
1. **WHOIS/RIPE lookup**: ❌ Geeft bedrijfsadres, niet server locatie
2. **Reverse DNS**: ⚠️ Nuttig als aanvulling, niet alleenstaand
3. **RTT validatie**: ✅ Kan "onmogelijke" locaties detecteren via fysica
4. **HTTP headers**: ✅ Meest betrouwbaar voor CDN edge (x-amz-cf-pop, x-served-by)

### Beslissingen
- **Multi-source approach**: Combineer headers + DNS + IP-geo met RTT validatie
- **Shared codebase**: SmartGeoResolver werkt in beide omgevingen met platform-specifieke inputs
- **Graceful degradation**: Webapp gebruikt wat beschikbaar is, Electron heeft volledige access

### Trade-offs
- **Complexity vs Accuracy**: Meer bronnen = meer code, maar significant betere resultaten
- **API calls**: Reverse DNS kan extra latency toevoegen (mitigeren met caching)

## Implementation Details

### Nieuwe Bestanden
- `app/app/src/services/geo/GeoLocationValidator.ts` - RTT validatie logica
- `app/app/src/services/geo/SmartGeoResolver.ts` - Multi-source orchestrator

### Gewijzigde Bestanden
- `app/app/src/services/geo/IGeoProvider.ts` - Toevoegen confidence/source velden
- `app/app/src/services/ElectronTopologyService.ts` - Gebruik SmartGeoResolver
- `app/app/src/services/DeepPacketAnalyser.ts` - Header doorsturen voor webapp

### Validatie
- Unit test: België user + 8ms RTT + "San Francisco" → detecteert als "impossible"
- Integratie test: Traceroute naar CDN toont correcte locatie uit headers
- Regressie test: Webapp functionaliteit blijft intact
```

---

## Stap 4: ROADMAP.md Updaten

**Bestand**: `app/docs/ROADMAP.md`

**Wijzigingen**:

1. **Known Bug updaten** (regel ~24):
```markdown
- [ ] ~~MaxMind vs CDN Header Location Mismatch~~: → Zie [Smart Geolocation](features/smart-geolocation.md)
```

2. **Planned Work toevoegen** (na regel ~29):
```markdown
- [ ] **[Smart Geolocation](features/smart-geolocation.md)**: RTT-validatie en multi-source fallback voor betere CDN endpoint locaties in Electron en webapp.
```

---

## Stap 5: Commit Documentatie

**In submodule (app/)**:
```bash
cd app
git add docs/features/smart-geolocation.md docs/ROADMAP.md
git commit -m "docs: add Smart Geolocation feature specification"
```

**In main repo (oli-electron)**:
```bash
cd /Users/markminnoye/git/oli-electron
git add app
git commit -m "chore: update app submodule with smart-geolocation docs"
```

---

## Branch Structuur na Setup

```
oli-electron/                     app/ submodule
─────────────────────────────────────────────────
feature/smart-geolocation    →    feature/smart-geolocation
         │                                 │
         └── points to ───────────────────→│
```

---

## Verificatie / Definition of Done

| Stap | Doel | Verificatie |
|------|------|-------------|
| 1 | Submodule branch | `cd app && git branch` toont `feature/smart-geolocation` |
| 2 | Main repo branch | `git branch` toont `feature/smart-geolocation` |
| 3 | Feature doc | `app/docs/features/smart-geolocation.md` bestaat |
| 4 | Roadmap updated | ROADMAP.md bevat link naar nieuwe feature |
| 5 | Commits | Beide repos hebben documentatie commits |

---

## Volgende Stappen (na goedkeuring)
Na het uitvoeren van dit plan is de documentatie-basis gelegd en kunnen we starten met de implementatie van:
1. `GeoLocationValidator.ts`
2. `SmartGeoResolver.ts`
3. Integratie in bestaande services
