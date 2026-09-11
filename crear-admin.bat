@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title W Drivers - Crear Usuario Admin

REM ============================================================================
REM  FlotaManager (Clean Architecture) - Crear el usuario administrador inicial
REM  Coloca este archivo dentro de la carpeta "server" y ejecutalo con doble clic.
REM ============================================================================

cd /d "%~dp0"

echo.
echo  ============================================================
echo    W Drivers - Creacion del usuario administrador
echo  ============================================================
echo.

REM --- 1. Verificar Node.js --------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] Node.js no esta instalado o no esta en el PATH.
    echo  Descargalo desde https://nodejs.org ^(version LTS^) y reintenta.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js detectado (%NODE_VER%)

REM --- 2. Verificar .env -----------------------------------------------------
if not exist ".env" (
    echo.
    echo  [ERROR] No se encontro el archivo .env en esta carpeta.
    echo  Crea un .env a partir de .env.example con tu MONGODB_URI.
    echo.
    pause
    exit /b 1
)
echo  [OK] Archivo .env encontrado

REM --- 3. Dependencias -------------------------------------------------------
if not exist "node_modules" (
    echo.
    echo  [INFO] Instalando dependencias ^(solo la primera vez^)...
    echo.
    call npm install
    if errorlevel 1 (
        echo  [ERROR] Fallo la instalacion de dependencias.
        pause
        exit /b 1
    )
    echo  [OK] Dependencias instaladas
)

REM --- 4. Pedir credenciales -------------------------------------------------
echo.
echo  ------------------------------------------------------------
echo    Ingresa los datos del administrador
echo  ------------------------------------------------------------
echo.
set "ADMIN_USER="
set /p ADMIN_USER="  Usuario (Enter para usar 'admin'): "
if "!ADMIN_USER!"=="" set "ADMIN_USER=admin"

:ASK_PASS
set "ADMIN_PASS="
set /p ADMIN_PASS="  Contrasena (minimo 4 caracteres): "
if "!ADMIN_PASS!"=="" (
    echo  [!] La contrasena no puede estar vacia. Intenta de nuevo.
    goto ASK_PASS
)

echo.
echo  ------------------------------------------------------------
echo    Usuario:    !ADMIN_USER!
echo    Contrasena: !ADMIN_PASS!
echo  ------------------------------------------------------------
echo.
set "CONFIRM="
set /p CONFIRM="  Crear este usuario? (S/N): "
if /i not "!CONFIRM!"=="S" (
    echo.
    echo  Operacion cancelada.
    pause
    exit /b 0
)

REM --- 5. Ejecutar el seed ---------------------------------------------------
echo.
echo  Conectando a la base de datos e insertando...
node src/seed.js "!ADMIN_USER!" "!ADMIN_PASS!"

if errorlevel 1 (
    echo.
    echo  [ERROR] No se pudo crear el usuario. Revisa el mensaje de arriba
    echo          y verifica tu MONGODB_URI en el archivo .env.
    echo.
    pause
    exit /b 1
)

echo.
echo  Recuerda: en esta version los carros se agregan desde la app,
echo  en la pestana "Carros", usando la placa real del vehiculo.
echo.
pause
exit /b 0
