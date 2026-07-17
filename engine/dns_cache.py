"""
Vacuna contra DNS flameante (visto 17-jul-2026: el resolver de la red fallaba
a ratos con los dominios .com.br de Smiles y tiraba corridas enteras).

Envuelve socket.getaddrinfo con un caché: cada resolución exitosa se guarda,
y si el DNS falla se usa la última dirección conocida de ese host. Mientras
la IP de Smiles no cambie en el medio de la falla (rarísimo), el motor sigue
como si nada.

Se activa importando el módulo:  import dns_cache  (ya lo hace smiles_client).
"""
import socket

_original = socket.getaddrinfo
_cache = {}


def _getaddrinfo_cacheado(host, *args, **kwargs):
    clave = (host, args[0] if args else None)
    try:
        res = _original(host, *args, **kwargs)
        _cache[clave] = res
        return res
    except socket.gaierror:
        if clave in _cache:
            return _cache[clave]
        raise


def activar():
    if socket.getaddrinfo is not _getaddrinfo_cacheado:
        socket.getaddrinfo = _getaddrinfo_cacheado


def precalentar(hosts):
    """Resuelve los hosts críticos al arrancar, para tener el caché listo."""
    for h in hosts:
        try:
            _getaddrinfo_cacheado(h, 443)
        except socket.gaierror:
            pass


activar()
