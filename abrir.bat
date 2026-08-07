@echo off
chcp 65001 >nul
title Controle de Pacotes - TikTok Shop
cd /d "%~dp0"

set PORTA=4173

echo.
echo   Controle de Pacotes - TikTok Shop
echo   =================================
echo.
echo   O sistema nao pode ser aberto com duplo clique no index.html:
echo   o navegador bloqueia o carregamento dos modulos e o banco de dados
echo   local quando a pagina vem de um arquivo solto. Por isso este atalho
echo   sobe um servidor local antes de abrir.
echo.

where python >nul 2>nul
if %errorlevel%==0 (
    echo   Subindo o servidor com Python na porta %PORTA%...
    start "Servidor - Controle de Pacotes" /min python -m http.server %PORTA%
    goto :abrir
)

where npx >nul 2>nul
if %errorlevel%==0 (
    echo   Subindo o servidor com Node na porta %PORTA%...
    start "Servidor - Controle de Pacotes" /min npx --yes serve -l %PORTA% .
    goto :abrir
)

echo   [ERRO] Nao encontrei Python nem Node instalados nesta maquina.
echo   Instale um dos dois e rode este arquivo de novo.
echo.
pause
exit /b 1

:abrir
rem `ping` como pausa: o `timeout` do Windows falha quando a entrada do
rem console esta redirecionada, o que quebra o atalho em alguns contextos.
ping -n 4 127.0.0.1 >nul
start "" http://localhost:%PORTA%

echo.
echo   Pronto. O sistema abriu em http://localhost:%PORTA%
echo.
echo   Para DESLIGAR: feche a janela minimizada chamada
echo   "Servidor - Controle de Pacotes" na barra de tarefas.
echo.
ping -n 7 127.0.0.1 >nul
exit /b 0
