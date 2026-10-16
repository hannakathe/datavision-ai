# DataVision AI

Aplicación web para el taller **«Aplicación de la IA en el mundo empresarial y desarrollo de un dashboard inteligente»**.

DataVision AI **no es un dashboard fijo de ventas**: es un generador de dashboards. Recibe conjuntos de datos de cualquier área (ventas, inventario, talento humano, finanzas, operaciones, encuestas, proyectos o datos propios), detecta las columnas y sus tipos, evalúa la calidad de los datos, propone indicadores y gráficas adecuados a la estructura encontrada y explica los patrones con un análisis estadístico basado en reglas.

> Proyecto académico para ejecución local. No está preparado para producción empresarial (ver [Limitaciones](#limitaciones-conocidas)).

## Contenido

- [Requisitos](#requisitos-previos) · [Instalación y ejecución](#instalación-y-ejecución) · [Comandos](#comandos-disponibles) · [Configuración](#configuración)
- [Entrada de datos](#métodos-de-entrada-de-datos) · [Gestión y validación](#gestión-procesamiento-y-validación) · [Dashboards](#generador-dinámico-de-dashboards) · [Análisis inteligente](#análisis-inteligente)
- [Pruebas](#pruebas) · [Estructura](#estructura-del-proyecto) · [API](#api-rest-interna) · [Seguridad y limitaciones](#limitaciones-conocidas) · [Ejecución local](#ejecución-local-y-publicación-opcional)

## Tecnologías

| Capa | Tecnología | Uso |
|---|---|---|
| Servidor | Node.js ≥ 22.13 (probado con 24.11) + **Express 5** | API REST modular, archivos estáticos, manejo centralizado de errores |
| Persistencia | **SQLite** mediante el módulo integrado `node:sqlite` | Conjuntos de datos, filas y configuraciones de dashboard. Sin compilación nativa |
| Carga de archivos | multer (memoria, con límite de tamaño) | Recepción de CSV/JSON/XLSX/SQLite |
| CSV | papaparse | Detección de separador (`,` `;` tab `|`), comillas, exportación con escape de fórmulas |
| Excel | exceljs | Lectura de `.xlsx` (valores calculados, nunca fórmulas) |
| Frontend | HTML5, CSS3 y JavaScript (módulos ES, sin framework) | SPA en español con enrutamiento por hash |
| Gráficas | **Chart.js 4** servido localmente desde `node_modules` | Barras, líneas, dona, sectores, histogramas, dispersión |
| Pruebas | `node:test` (integrado) | Pruebas unitarias, de importadores, de API y de consola |

No se usó un framework de frontend ni una librería de validación: la lógica de análisis está en módulos ES puros (`public/js/core/`) que **comparten el navegador y el servidor**, lo que evita duplicar código. No hace falta ningún servicio de pago ni conexión a internet.

## Requisitos previos

- **Node.js 22.13 o superior** (incluye `node:sqlite`). Comprueba con `node -v`.
- npm (incluido con Node.js).

Node 24 muestra el aviso `ExperimentalWarning: SQLite is an experimental feature`; es informativo. Los scripts de npm usan `--no-warnings` donde corresponde.

## Instalación y ejecución

```bash
npm install
```

```bash
npm start
```

Abre **http://localhost:3000**. El mismo proceso sirve el frontend y la API (no hay que iniciar dos servidores). En el primer arranque se crea `storage/datavision.sqlite` y se cargan los cinco conjuntos **ficticios** de demostración (desactivable con `SEED_DEMO=false`).

Para desarrollo con recarga automática del servidor:

```bash
npm run dev
```

## Comandos disponibles

| Comando | Descripción |
|---|---|
| `npm start` | Inicia servidor + interfaz en `http://localhost:3000` |
| `npm run dev` | Igual, con `node --watch` |
| `npm test` | Ejecuta todas las pruebas automatizadas |
| `npm run import -- <archivo> [opciones]` | Importa un archivo desde la consola |
| `npm run cli -- list` | Lista los conjuntos almacenados |
| `npm run cli -- delete <id>` | Elimina un conjunto |
| `npm run seed` | Carga los datos de demostración que falten |
| `npm run demo:generate` | Regenera (de forma determinista) los archivos de `data/demo` y `data/samples` |

## Configuración

Variables de entorno (todas opcionales; ver `.env.example`). No hay secretos ni claves.

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `HOST` | `127.0.0.1` | Interfaz de escucha. `127.0.0.1` = solo este equipo; `0.0.0.0` para servidor |
| `DATA_DIR` | `storage` | Carpeta de la base SQLite |
| `MAX_UPLOAD_MB` | `5` | Tamaño máximo por archivo |
| `MAX_ROWS` | `50000` | Filas máximas por conjunto |
| `MAX_COLUMNS` | `200` | Columnas máximas por conjunto |
| `SEED_DEMO` | `true` | Cargar datos de demostración en el primer arranque |

Ejemplo en PowerShell: `$env:PORT=4000; npm start` · en bash: `PORT=4000 npm start`.

## Métodos de entrada de datos

| Método | Estado | Dónde |
|---|---|---|
| Archivo CSV / TSV / TXT | ✅ Funciona y probado | Interfaz «Importar datos», consola |
| Archivo JSON | ✅ Funciona y probado | Interfaz, consola |
| Excel `.xlsx` | ✅ Funciona y probado | Interfaz (selección de hoja), consola (`--sheet`) |
| Archivo SQLite `.db/.sqlite/.sqlite3` | ✅ Funciona y probado | Interfaz (selección de tabla), consola (`--table`) |
| Editor manual / pegar desde Excel | ✅ Funciona y probado | «Editor manual» |
| Consola de Node.js | ✅ Funciona y probado | `npm run import` |
| API REST externa | ⏳ Ampliación futura, **no implementado** | Arquitectura preparada |
| PostgreSQL / MySQL / SQL Server | ⏳ Ampliación futura, **no implementado** | Arquitectura preparada |
| Archivos `.xls` (Excel 97-2003) | ❌ No soportado | Guardar como `.xlsx` o CSV |

### A. Importar CSV, JSON o XLSX desde la interfaz

1. Menú **Importar datos** → arrastra el archivo o haz clic en la zona de carga (también con teclado: Enter/Espacio).
2. Revisa la **vista previa**: número de filas y columnas, esquema detectado (tipo, rol, vacíos, inválidos, únicos, ejemplos), problemas de calidad y las primeras 20 filas.
3. Si el libro de Excel tiene varias hojas, o la base SQLite varias tablas, elige cuál importar.
4. Escribe el nombre (y opcionalmente una descripción) y pulsa **Guardar y generar dashboard** o **Guardar y revisar**.

Formatos reconocidos:

- **CSV**: separador detectado automáticamente (coma, punto y coma, tabulación o barra vertical); UTF-8 con o sin BOM y Latin-1 (archivos «CSV» de Excel en Windows). La primera fila son los encabezados.
- **JSON**: un arreglo de objetos `[{"col": valor}]`, un objeto con propiedad `data`/`rows`/`records`/`items`, o un arreglo de arreglos (la primera fila son los encabezados). Los objetos anidados se aplanan como `padre.hijo`.
- **XLSX**: se importa la primera hoja con datos (o la elegida). De las celdas con fórmula se toma **solo el valor calculado**; las fórmulas nunca se ejecutan. Las fechas se convierten a `AAAA-MM-DD`.
- **Números**: `1234.5`, `1,234.5`, `1.234,5`, `$ 1.200.000`, `45%`, `(300)` (negativo). Un único punto se interpreta como decimal.
- **Fechas**: `AAAA-MM-DD` (con hora opcional), `DD/MM/AAAA`, `AAAA/MM/DD`, `AAAA-MM`.

### B. Entrada manual

Menú **Editor manual**: escribe el nombre del conjunto, edita los encabezados, añade/elimina filas y columnas y guarda. En **«Pegar datos desde Excel, Google Sheets o texto»** puedes pegar un rango copiado (tabulaciones, `;` o `,`). Los tipos se detectan al guardar. Un conjunto existente de hasta 2000 filas puede editarse desde su vista de detalle (**Editar datos**).

### C. Consola de Node.js

```bash
npm run import -- data/samples/proyectos.json --name "Proyectos TI" --description "Cartera 2025"
```

```bash
npm run import -- data/demo/recursos_humanos.xlsx --sheet Empleados
```

```bash
npm run import -- data/samples/operaciones.sqlite --table produccion
```

Salida de ejemplo:

```
✔ Importación completada: #<id> «Proyectos TI»
  6 filas · 7 columnas · estado: Válido
  Columnas: proyecto (texto), responsable (categoria), estado (categoria), avance_pct (numerico), ...
```

Si falla (archivo inexistente, JSON inválido, archivo sin filas, tabla inexistente…) se muestra `✖ La operación falló: <motivo>` y el proceso termina con código 1. La consola escribe en la misma base SQLite que el servidor; recarga la página para ver el conjunto nuevo.

### D. Base de datos SQLite

- **Almacenamiento interno**: todo se guarda en `storage/datavision.sqlite` (tablas `datasets`, `dataset_rows`, `dashboards`, `meta`), con sentencias preparadas y borrado en cascada.
- **Conector de importación**: sube un archivo `.db/.sqlite/.sqlite3` (o usa `--table` en consola). Se verifica la firma del archivo, se abre en **modo solo lectura** en una copia temporal, se listan las tablas y vistas y solo se puede leer una tabla **de esa lista** (identificador entrecomillado). **No se permite SQL arbitrario.**
- **Consulta segura**: `POST /api/datasets/:id/query` acepta una consulta estructurada (filtros, búsqueda, orden, columnas, paginación) validada contra el esquema; nunca texto SQL.

### E. Arquitectura extensible de importadores

`server/importers/index.js` registra los conectores. Cada uno implementa `parse(buffer, opciones) → { columns, rows, warnings, meta }`; la normalización, detección de tipos, validación y guardado son comunes (`server/services/ingest.js`). Para añadir, por ejemplo, un conector REST: crear `server/importers/rest.js` con esa firma, registrarlo y exponer una ruta que reciba la URL validada. Los conectores REST y de otros motores figuran como «planificado» en la interfaz y **no están implementados**.

## Gestión, procesamiento y validación

**Conjuntos de datos** (menú «Conjuntos de datos»): cada uno guarda nombre, descripción, fecha de creación/actualización, origen (formato y archivo/hoja/tabla), filas, columnas, esquema detectado y estado de validación (`Válido`, `Con advertencias`, `Con errores`). Se pueden abrir, renombrar, exportar a CSV y eliminar (con confirmación; también se eliminan sus configuraciones).

**Detección automática** al importar o crear:

1. Tipos: numérico, fecha, booleano (sí/no, true/false…), categoría (pocos valores distintos) o texto. Una columna adopta un tipo si ≥ 80 % de sus valores no vacíos lo cumplen; el resto se informa como **inválido**.
2. Roles: medida, dimensión, tiempo, identificador (`id`, `sku`, `codigo…`, o texto con todos los valores únicos) o atributo. Los identificadores no se suman ni se usan como dimensión.
3. Calidad: vacíos por columna, valores inválidos con ejemplos, filas duplicadas exactas, posibles atípicos (regla 1,5·IQR), celdas que parecen fórmulas (`=`, `+`, `-`, `@`), filas vacías omitidas, encabezados renombrados.

**Nada se modifica en silencio.** En la vista de detalle puedes:

- Cambiar el tipo de una columna (se recalcula la validación).
- Aplicar correcciones opcionales: eliminar duplicados; para cada columna con vacíos, eliminar esas filas o reemplazarlas por un valor, el promedio, la mediana (solo numéricas) o el valor más frecuente. Por defecto se crea **una copia «(limpio)»**; reemplazar el original exige confirmación.
- Buscar, ordenar y paginar los registros.

## Generador dinámico de dashboards

Menú **Dashboard** → elige el conjunto en el selector superior. El dashboard se construye a partir del esquema, sin nombres de columnas predefinidos:

- **KPI (hasta 4, configurables)**: recuento de registros; suma de medidas aditivas (montos, unidades, cantidades) o promedio de medidas no aditivas (precios, edades, calificaciones, porcentajes); valores únicos con la categoría más frecuente; % de «Sí» en booleanos; rango de fechas. Si hay una columna de fecha con granularidad mensual o trimestral, se muestra la **variación frente al período inmediatamente anterior** y una mini-serie. No se inventan indicadores financieros.
- **Páginas (pestañas)**: *Resumen ejecutivo* (gráfica temporal principal, comparación por la dimensión principal, dona de composición y panel de **factores destacados**), *Tendencias* (series temporales), *Distribuciones* (histogramas y frecuencias), *Relaciones* (dispersión entre los pares numéricos más correlacionados y promedios por grupo), *Registros* y *Análisis inteligente*.
- **Reglas anti-engaño**: los sectores solo admiten recuento o suma y no valores negativos (máx. 8 porciones; el resto en «Otros»); las líneas exigen una dimensión ordenada (fecha); las columnas numéricas continuas se envían a histograma; las barras y áreas empiezan en cero; se avisa al sumar columnas no aditivas; se informan los registros excluidos por vacíos; la línea de tendencia/proyección se rotula como regresión lineal simple con su R² y la advertencia de que no es un pronóstico.
- **Configuración manual** (icono de ajustes de cada gráfica o «Añadir gráfica»): tipo de gráfica, columna a analizar, operación (recuento, suma, promedio, mediana, mínimo, máximo, valores únicos), variable numérica, agrupación temporal (día, mes, trimestre, año), máximo de grupos, página y título. Las combinaciones inválidas se explican antes de aplicarlas.
- **Filtros dinámicos** según el tipo de cada columna (casillas para categorías/booleanos, rangos para números y fechas, «contiene» para texto) y **búsqueda global**. Indicadores, gráficas, registros y análisis se recalculan al instante.
- **Registros que respaldan los resultados**: clic en una barra, porción o intervalo para ver sus filas; botón de ojo para ver los registros filtrados; botón de tabla para leer los valores de la gráfica (alternativa accesible).
- **Guardar configuración**: se guardan KPI, gráficas, filtros y búsqueda (no imágenes) en SQLite, vinculados al conjunto. Se pueden recuperar, actualizar y eliminar. Al cargarlas se descartan referencias a columnas que ya no existan.

## Análisis inteligente

Pestaña **Análisis inteligente** del dashboard (o menú del mismo nombre). **Funciona sin ninguna API externa**: es un motor de reglas estadísticas interpretables y la interfaz lo declara así. No simula una IA generativa.

Genera conclusiones sobre: alcance del análisis; distribución de medidas (promedio, mediana, rango, sesgo); categorías principales y concentración (participación del primer grupo y de los tres primeros); comparación de promedios entre grupos (indicando que no hay prueba de significancia); variación temporal (primer vs último período, pico, tendencia lineal con R², aviso de períodos posiblemente incompletos); correlaciones de Pearson con |r| ≥ 0,5 y n ≥ 10 (**siempre aclarando que correlación no implica causalidad**); atípicos por IQR; datos faltantes y duplicados. Cada conclusión muestra su **«Respaldo»** (cálculo y datos). Si los datos no alcanzan (menos de 5 registros, menos de 3 períodos, sin columnas numéricas), lo dice explícitamente. Respeta los filtros activos.

**Integración futura con un proveedor de IA**: no se implementó. Para añadirla habría que crear un módulo de servidor que reciba el resumen estadístico (no los datos crudos), leer la clave desde una variable de entorno, pedir consentimiento explícito al usuario antes de cada envío y mantener el funcionamiento actual cuando no esté configurada. La aplicación **no envía datos a terceros**.

## Datos de demostración

Todos son **ficticios**, generados por `scripts/generate-demo.js` con semilla fija, e identificados con el prefijo `[DEMO]`, una etiqueta en la interfaz y la descripción «DATOS FICTICIOS DE DEMOSTRACIÓN». Pueden eliminarse y volver a cargarse desde Inicio.

| Archivo | Área | Particularidades |
|---|---|---|
| `data/demo/ventas.csv` | Ventas | 642 filas, 2 duplicados y vacíos intencionales |
| `data/demo/inventario.json` | Inventario | JSON con objetos anidados (`proveedor.pais`) y booleano |
| `data/demo/recursos_humanos.xlsx` | Recursos humanos | Excel con fechas y una columna con fórmula |
| `data/demo/finanzas.csv` | Finanzas | Separador `;` y números `420.000.000,00` |
| `data/demo/encuesta_satisfaccion.csv` | Personalizado (encuesta) | Correlación negativa espera ↔ calificación |

Muestras para probar casos no incluidos en los ejemplos (`data/samples/`): `proyectos.json` (otro esquema), `con_errores.csv` (inválidos, vacíos, duplicados, fórmula), `vacio.csv`, `invalido.json` y `operaciones.sqlite` (tablas `produccion` y `maquinas`).

## Pruebas

```bash
npm test
```

Resultado de la última ejecución: **28 pruebas, 28 aprobadas, 0 fallidas**.

| Archivo | Cubre |
|---|---|
| `test/core.test.js` | Conversión de números/fechas/booleanos, inferencia de tipos y roles, calidad (vacíos, inválidos, duplicados, atípicos, fórmulas), KPI y gráficas para esquemas distintos, validación de gráficas engañosas, filtros, «Otros», saneamiento de configuraciones, análisis (respaldo, no causalidad, datos insuficientes, conjunto vacío) |
| `test/importers.test.js` | CSV (coma, `;`, Latin-1), JSON anidado, XLSX con fórmulas y fechas, SQLite (tablas, nombre de tabla malicioso, archivo falso), JSON inválido, archivo vacío, extensión no soportada, encabezados `__proto__`/vacíos/repetidos |
| `test/api.test.js` | Rutas principales y estáticos, cabeceras de seguridad, importación CSV/JSON/XLSX/SQLite por HTTP, archivo > límite (413), conjunto vacío, entrada manual y su validación, renombrar, cambiar tipos, consulta segura, limpieza en copia, exportación con escape de fórmulas, eliminación en cascada, configuraciones de dashboard (guardar/recuperar/actualizar/eliminar), **persistencia tras cerrar y reabrir SQLite**, carga única de demos |
| `test/cli.test.js` | Importación por consola (CSV, JSON, SQLite), `list`, `delete` y mensajes/códigos de error |

**Pruebas manuales realizadas en el navegador** (no automatizadas): carga de dashboards de varios conjuntos, clic en barras para ver los registros que las respaldan, filtros por casillas, pestaña de análisis con filtros, importación de un CSV nuevo por arrastrar y soltar → dashboard, editor manual con pegado de datos y fila añadida, guardado de configuración y recuperación tras recargar, vista móvil (375 px, sin desplazamiento horizontal) y modos claro/oscuro.

**No probado**: lectores de pantalla reales, navegadores distintos de Chromium y conjuntos cercanos al límite de 50 000 filas.

## Estructura del proyecto

```
├── server/
│   ├── index.js            Arranque: SQLite, datos demo, servidor HTTP
│   ├── app.js              Express: cabeceras de seguridad, API, estáticos, errores
│   ├── config.js           Variables de entorno y límites
│   ├── db.js               Store SQLite (node:sqlite, sentencias preparadas)
│   ├── errors.js           AppError y manejador centralizado
│   ├── routes/api.js       Rutas REST
│   ├── importers/          csv.js, json.js, xlsx.js, sqlite.js, index.js (registro)
│   └── services/           ingest.js (normalización), datasets.js (negocio), demo.js
├── public/
│   ├── index.html, css/styles.css, favicon.svg
│   └── js/
│       ├── core/           types, stats, quality, data, dashboard, insights, format (compartidos con el servidor)
│       ├── views/          home, import, editor, datasets, detail, dashboard, records, validation
│       ├── app.js          Enrutador y estructura
│       ├── api.js, ui.js, charts.js, state.js
├── scripts/                cli.js (consola), generate-demo.js
├── data/demo, data/samples Datos ficticios y muestras de prueba
├── test/                   Pruebas node:test
└── storage/                Base SQLite local (se crea al iniciar; ignorada por git)
```

## API REST interna

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado |
| GET | `/api/importers` | Conectores y límites |
| POST | `/api/import/preview` | Multipart `archivo` (+ `sheet`/`table`) → vista previa y `uploadId` (válido 20 min) |
| POST | `/api/import/commit` | `{ uploadId, name, description }` |
| GET/POST | `/api/datasets` | Listar / crear manual `{ name, columns, rows }` |
| GET/PATCH/DELETE | `/api/datasets/:id` | Detalle / `{ name, description, columnTypes }` / eliminar |
| GET/PUT | `/api/datasets/:id/rows` | Filas / reemplazar desde el editor |
| POST | `/api/datasets/:id/query` | Consulta estructurada segura |
| POST | `/api/datasets/:id/clean` | `{ removeDuplicates, missing:[{column,strategy,value}], mode:'copy'|'replace' }` |
| GET | `/api/datasets/:id/export.csv` | Exportación con escape de fórmulas |
| GET/POST | `/api/datasets/:id/dashboards` | Configuraciones del conjunto |
| GET/PUT/DELETE | `/api/dashboards/:id` | Configuración guardada |
| POST | `/api/demo/load` | Carga los datos demo que falten |

## Limitaciones conocidas

Seguridad implementada: validación en servidor de extensión, firma (SQLite), tamaño, filas, columnas y estructura; límites de cuerpo JSON (10 MB); saneamiento de encabezados (`__proto__`, etc.) y caracteres de control; recorte de celdas > 5000 caracteres; ningún `eval` ni ejecución de contenido importado; fórmulas tratadas como texto y escapadas al exportar; interfaz que inserta texto con `textContent` (sin HTML del usuario); cabeceras `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; errores internos sin detalles técnicos hacia el usuario; servidor ligado a `127.0.0.1` por defecto.

Limitaciones:

- **Sin autenticación ni control de acceso**: cualquiera que alcance el puerto puede leer, modificar y borrar datos. Por eso escucha solo en `127.0.0.1` por defecto. **No es apta para producción empresarial** tal como está (faltan usuarios/roles, HTTPS, limitación de peticiones, auditoría, copias de seguridad).
- El análisis se hace en el navegador sobre todas las filas del conjunto (máx. 50 000): conjuntos grandes pueden tardar en cargar en equipos modestos.
- La vista previa de importación se guarda en memoria del servidor (20 min); si se reinicia el servidor hay que volver a seleccionar el archivo.
- Inferencia de fechas: `DD/MM/AAAA` se asume día/mes salvo que el segundo número sea > 12. `1.234` (un solo punto) se interpreta como decimal.
- No se admiten `.xls` antiguos ni Excel protegidos con contraseña; las celdas combinadas se leen como valores sueltos.
- La línea de proyección es una regresión lineal simple sin estacionalidad: es ilustrativa, no un modelo de pronóstico.
- Conectores REST y de otros motores SQL: solo arquitectura; no implementados.
- `node:sqlite` aún es experimental en Node 24 (funciona, pero su API podría cambiar).

## Ejecución local y publicación (opcional)

La aplicación está pensada para **ejecutarse en local** con `npm start`: no requiere publicarse en internet. Los datos quedan en `storage/datavision.sqlite` y persisten entre reinicios; para empezar de cero basta con detener el servidor y borrar la carpeta `storage/`.

Solo si en el futuro se quisiera publicar en un servidor Node.js: usar `HOST=0.0.0.0`, apuntar `DATA_DIR` a un disco persistente (muchos servicios gratuitos borran los archivos al reiniciar) y añadir antes autenticación y HTTPS. La aplicación no se ha publicado y no tiene URL pública.
