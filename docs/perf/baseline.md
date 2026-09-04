# Línea base de rendimiento — peso de JavaScript por pantalla

Generado por `node scripts/perf-baseline.mjs`. **No editar a mano**: se sobrescribe.

- Build: `3TS0TQroBF-dLk-CLF3VL`
- Generado: 2026-09-04T01:08:47.389Z

`gzip` es lo que viaja por la red. `disco` es lo que el navegador tiene que analizar y ejecutar, que es lo que se nota en un celular de gama media.

| Pantalla | gzip | disco | Fragmentos |
| --- | ---: | ---: | ---: |
| `/groups/[groupId]` | 1089 KB | 3966 KB | 45 |
| `/u/[handle]` | 1077 KB | 3900 KB | 48 |
| `/` | 1019 KB | 3657 KB | 46 |
| `/saved` | 988 KB | 3553 KB | 42 |
| `/post/[postId]` | 981 KB | 3531 KB | 42 |
| `/wallet/finanzas` | 932 KB | 3331 KB | 44 |
| `/p/[postId]` | 805 KB | 2877 KB | 30 |
| `/wallet/estadisticas` | 775 KB | 2757 KB | 41 |
| `/reels/[storyId]` | 713 KB | 2538 KB | 39 |
| `/reels` | 712 KB | 2537 KB | 39 |
| `/wallet/calendario` | 708 KB | 2542 KB | 40 |
| `/search` | 706 KB | 2517 KB | 37 |
| `/wallet/historial` | 706 KB | 2529 KB | 40 |
| `/wallet/pendientes` | 705 KB | 2528 KB | 40 |
| `/experiencias` | 700 KB | 2498 KB | 38 |
| `/wallet` | 693 KB | 2482 KB | 38 |
| `/groups/new` | 681 KB | 2437 KB | 33 |
| `/sessions` | 681 KB | 2423 KB | 36 |
| `/mensajes/[conversationId]` | 680 KB | 2418 KB | 36 |
| `/mensajes` | 678 KB | 2414 KB | 36 |
| `/notifications` | 678 KB | 2413 KB | 36 |
| `/sessions/[sessionId]/call` | 677 KB | 2413 KB | 36 |
| `/menu` | 677 KB | 2411 KB | 36 |
| `/groups` | 677 KB | 2411 KB | 36 |
| `/express` | 515 KB | 1814 KB | 25 |
| `/login` | 508 KB | 1803 KB | 23 |
| `/admin/retiros` | 488 KB | 1712 KB | 23 |
| `/admin/refunds` | 485 KB | 1705 KB | 23 |
| `/admin/reports/[reportId]` | 484 KB | 1702 KB | 23 |
| `/admin/profile` | 484 KB | 1701 KB | 23 |
| `/admin/private-communities` | 484 KB | 1703 KB | 23 |
| `/admin/migraciones` | 484 KB | 1704 KB | 23 |
| `/admin/hidden-communities` | 484 KB | 1702 KB | 23 |
| `/admin/reports` | 483 KB | 1698 KB | 23 |
| `/admin/audit-log` | 483 KB | 1697 KB | 23 |
| `/admin/other-reports` | 483 KB | 1697 KB | 23 |
| `/admin/my-reports` | 483 KB | 1697 KB | 23 |
| `/admin/users` | 482 KB | 1696 KB | 23 |
| `/invite/[token]` | 481 KB | 1692 KB | 22 |
| `/admin` | 481 KB | 1692 KB | 22 |
| `/live-overlay/[postId]` | 479 KB | 1685 KB | 22 |
| `/complete-profile` | 478 KB | 1682 KB | 22 |
| **compartido por todas** | **477 KB** | **1680 KB** | **21** |
