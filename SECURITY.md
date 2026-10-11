# Seguridad

## Qué datos maneja

- **Token de acceso de Canvas.** Da acceso completo a tu cuenta de Canvas, así que trátalo como una contraseña.
- **Tus pendientes y notas.** Se leen del planner de Canvas y se guardan solo en memoria mientras la app corre.

## Dónde se guarda el token

- Cifrado con `safeStorage` en `token.enc`, con la clave en el llavero del sistema (GNOME Keyring o KWallet en Linux, DPAPI en Windows).
- Si no hay llavero, en texto plano en `token` con permisos 600. Ajustes lo marca como aviso.
- Carpeta: `~/.config/Canvas Today/` en Linux, `%APPDATA%\Canvas Today\` en Windows.

## A dónde se conecta

- Solo al dominio de Canvas que configures, por https. Al paginar, el token no se envía a otro dominio.
- No hay servidores propios, analítica ni actualizaciones automáticas.
- Para comprobarlo en Linux: `ss -tnp | grep -i canvas` con la app abierta.

## Aislamiento de la interfaz

- La interfaz corre con `contextIsolation` y `sandbox`, sin acceso a Node.
- Una política CSP estricta solo permite scripts propios.
- Se bloquea la navegación y la apertura de ventanas nuevas.
- Solo se abren en el navegador enlaces https del dominio de Canvas configurado.

## Verificar una descarga

Los instaladores no están firmados. Compara el hash con `SHA256SUMS.txt` de la misma release:

```bash
sha256sum Canvas-Today-*.AppImage
```

## Cadena de suministro

- Las acciones de GitHub están fijadas por hash de commit.
- Dependabot avisa de dependencias con versiones nuevas o vulnerables.
- La app no tiene dependencias de runtime; todo lo de `package.json` es solo para compilar.

## Reportar una vulnerabilidad

Usa **Security → Report a vulnerability** en este repositorio. No abras un issue público ni incluyas tokens reales.
