#!/usr/bin/env python3
"""
NoPort - Port Tunneling Tool for NAT Traversal
No external dependencies required.

Server: Runs on a machine with public IP and forwarded ports (7000-10000).
Client: Runs behind NAT, tunnels a local port to server's public port.

Usage:
    Server:  python3 noport.py server
    Client:  python3 noport.py client --local-port 8080
"""

import socket
import struct
import threading
import argparse
import sys

# ─── Protocol Constants ──────────────────────────────────────────────────────
# Wire format: [4B length][4B conn_id][1B type][payload...]
# Length = size of (conn_id + type + payload), excludes the 4-byte length field itself.

HEADER_SIZE = 9
MSG_DATA       = 0x00
MSG_NEW_CONN   = 0x01
MSG_CLOSE_CONN = 0x02
MSG_TUNNEL_REQ = 0x03
MSG_TUNNEL_RESP= 0x04

DEFAULT_SERVER_IP  = "174.169.230.116"
DEFAULT_CONTROL_PORT = 7000
DEFAULT_MIN_PORT     = 7000
DEFAULT_MAX_PORT     = 10000


# ─── Wire helpers ────────────────────────────────────────────────────────────

def pack_msg(conn_id: int, msg_type: int, data: bytes = b'') -> bytes:
    length = 4 + 1 + len(data)          # conn_id + type + payload
    return struct.pack('!IB', length, conn_id, msg_type) + data


def recv_exact(sock: socket.socket, n: int) -> bytes | None:
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def recv_msg(sock: socket.socket):
    """Returns (conn_id, msg_type, data) or (None, None, None) on EOF/error."""
    header = recv_exact(sock, HEADER_SIZE)
    if header is None:
        return None, None, None
    length, conn_id, msg_type = struct.unpack('!IB', header)
    data_len = length - 5               # subtract conn_id(4) + type(1)
    data = b''
    if data_len > 0:
        data = recv_exact(sock, data_len)
        if data is None:
            return None, None, None
    return conn_id, msg_type, data


# ═══════════════════════════════════════════════════════════════════════════════
#  SERVER
# ═══════════════════════════════════════════════════════════════════════════════

class TunnelServer:
    def __init__(self, host: str, control_port: int,
                 min_port: int, max_port: int):
        self.host = host
        self.control_port = control_port
        self.min_port = min_port
        self.max_port = max_port
        self.lock = threading.Lock()
        self.tunnels: dict[int, dict] = {}   # public_port -> tunnel info
        self.used_ports: set[int] = set()
        self._next_conn_id = 1

    # ── port allocator ───────────────────────────────────────────────────
    def _alloc_port(self) -> int | None:
        with self.lock:
            for p in range(self.min_port, self.max_port + 1):
                if p == self.control_port:
                    continue
                if p not in self.used_ports:
                    self.used_ports.add(p)
                    return p
        return None

    def _free_port(self, port: int):
        with self.lock:
            self.used_ports.discard(port)

    def _next_id(self) -> int:
        with self.lock:
            cid = self._next_conn_id
            self._next_conn_id += 1
            if self._next_conn_id > 0x7FFFFFFF:
                self._next_conn_id = 1
            return cid

    # ── accept tunnel client on control port ─────────────────────────────
    def _handle_client(self, client_sock: socket.socket, addr: tuple):
        print(f"[+] Tunnel client connected from {addr[0]}:{addr[1]}")
        try:
            conn_id, msg_type, data = recv_msg(client_sock)
            if msg_type != MSG_TUNNEL_REQ:
                print(f"[-] Expected TUNNEL_REQ, got type={msg_type}")
                client_sock.close()
                return

            local_port = int(data.decode())
            print(f"[+] Client wants to expose local port {local_port}")

            pub_port = self._alloc_port()
            if pub_port is None:
                client_sock.sendall(pack_msg(0, MSG_TUNNEL_RESP,
                                             b'ERROR: no free ports in range'))
                client_sock.close()
                return

            client_sock.sendall(pack_msg(0, MSG_TUNNEL_RESP,
                                         f'OK:{pub_port}'.encode()))
            print(f"[+] Tunnel bound  {self.host}:{pub_port}  ->  "
                  f"client:{local_port}")

            tunnel = {
                'sock': client_sock,
                'addr': addr,
                'local_port': local_port,
                'conns': {},        # conn_id -> user_socket
            }
            with self.lock:
                self.tunnels[pub_port] = tunnel

            # spin up public listener
            threading.Thread(target=self._public_listener,
                             args=(pub_port,), daemon=True).start()
            # read client→user stream
            self._client_to_user_loop(pub_port, client_sock)

        except Exception as exc:
            print(f"[-] Client handling error: {exc}")
        finally:
            client_sock.close()

    # ── public listener (one per tunnel) ─────────────────────────────────
    def _public_listener(self, pub_port: int):
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            srv.bind((self.host, pub_port))
            srv.listen(32)
            srv.settimeout(1.0)
            print(f"[*] Public listener on {self.host}:{pub_port}")

            while pub_port in self.tunnels:
                try:
                    user_sock, user_addr = srv.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break

                cid = self._next_id()
                with self.lock:
                    if pub_port not in self.tunnels:
                        user_sock.close()
                        continue
                    self.tunnels[pub_port]['conns'][cid] = user_sock

                # tell tunnel client about new connection
                self.tunnels[pub_port]['sock'].sendall(
                    pack_msg(cid, MSG_NEW_CONN))
                print(f"[+] User {user_addr[0]}:{user_addr[1]} -> "
                      f":{pub_port}  (conn #{cid})")

                threading.Thread(
                    target=self._user_to_client,
                    args=(user_sock, self.tunnels[pub_port]['sock'],
                          cid, pub_port),
                    daemon=True
                ).start()
        except Exception as exc:
            print(f"[-] Public listener error on :{pub_port}: {exc}")
        finally:
            srv.close()
            with self.lock:
                t = self.tunnels.pop(pub_port, None)
                if t:
                    for s in t['conns'].values():
                        try: s.close()
                        except OSError: pass
            self._free_port(pub_port)
            print(f"[-] Tunnel :{pub_port} removed")

    # ── user → client forwarder (one per user connection) ────────────────
    def _user_to_client(self, user_sock: socket.socket,
                        client_sock: socket.socket,
                        cid: int, pub_port: int):
        try:
            while True:
                data = user_sock.recv(65536)
                if not data:
                    break
                client_sock.sendall(pack_msg(cid, MSG_DATA, data))
        except OSError:
            pass
        finally:
            try:
                client_sock.sendall(pack_msg(cid, MSG_CLOSE_CONN))
            except OSError:
                pass
            user_sock.close()
            with self.lock:
                t = self.tunnels.get(pub_port)
                if t:
                    t['conns'].pop(cid, None)
            print(f"[-] User conn #{cid} closed")

    # ── client → users loop (one per tunnel client) ──────────────────────
    def _client_to_user_loop(self, pub_port: int,
                             client_sock: socket.socket):
        try:
            while True:
                cid, msg_type, data = recv_msg(client_sock)
                if cid is None:
                    break

                if msg_type == MSG_DATA:
                    with self.lock:
                        t = self.tunnels.get(pub_port)
                        sock = t['conns'].get(cid) if t else None
                    if sock:
                        try:
                            sock.sendall(data)
                        except OSError:
                            pass

                elif msg_type == MSG_CLOSE_CONN:
                    with self.lock:
                        t = self.tunnels.get(pub_port)
                        sock = t['conns'].pop(cid, None) if t else None
                    if sock:
                        try: sock.close()
                        except OSError: pass
                    print(f"[-] Conn #{cid} closed by client")
        except OSError:
            pass
        finally:
            print(f"[-] Tunnel client for :{pub_port} disconnected")
            # removing from self.tunnels causes public_listener to exit

    # ── main entry ───────────────────────────────────────────────────────
    def run(self):
        ctrl = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        ctrl.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        ctrl.bind((self.host, self.control_port))
        ctrl.listen(32)

        banner = f"""
╔══════════════════════════════════════════════╗
║           NoPort Tunnel Server              ║
╠══════════════════════════════════════════════╣
║  Control : {self.host}:{self.control_port:<27}║
║  Range   : {self.min_port}-{self.max_port:<30}║
╚══════════════════════════════════════════════╝
"""
        print(banner)

        try:
            while True:
                csock, caddr = ctrl.accept()
                threading.Thread(target=self._handle_client,
                                 args=(csock, caddr), daemon=True).start()
        except KeyboardInterrupt:
            print("\n[!] Shutting down")
        finally:
            ctrl.close()


# ═══════════════════════════════════════════════════════════════════════════════
#  CLIENT
# ═══════════════════════════════════════════════════════════════════════════════

class TunnelClient:
    def __init__(self, server_host: str, server_port: int,
                 local_host: str, local_port: int):
        self.server_host = server_host
        self.server_port = server_port
        self.local_host  = local_host
        self.local_port  = local_port
        self.lock = threading.Lock()
        self.conns: dict[int, socket.socket] = {}
        self.running = True

    # ── connect to local service ─────────────────────────────────────────
    def _connect_local(self, cid: int) -> socket.socket | None:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.connect((self.local_host, self.local_port))
            with self.lock:
                self.conns[cid] = s
            print(f"[+] Local conn #{cid} -> {self.local_host}:{self.local_port}")
            return s
        except OSError as exc:
            print(f"[-] Local connect failed for #{cid}: {exc}")
            return None

    # ── local → server forwarder ─────────────────────────────────────────
    def _local_to_server(self, cid: int, local_sock: socket.socket,
                         server_sock: socket.socket):
        try:
            while self.running:
                data = local_sock.recv(65536)
                if not data:
                    break
                server_sock.sendall(pack_msg(cid, MSG_DATA, data))
        except OSError:
            pass
        finally:
            try:
                server_sock.sendall(pack_msg(cid, MSG_CLOSE_CONN))
            except OSError:
                pass

    # ── server → local dispatcher ────────────────────────────────────────
    def _server_loop(self, server_sock: socket.socket):
        try:
            while self.running:
                cid, msg_type, data = recv_msg(server_sock)
                if cid is None:
                    break

                if msg_type == MSG_NEW_CONN:
                    local_sock = self._connect_local(cid)
                    if local_sock:
                        threading.Thread(
                            target=self._local_to_server,
                            args=(cid, local_sock, server_sock),
                            daemon=True
                        ).start()
                    else:
                        server_sock.sendall(pack_msg(cid, MSG_CLOSE_CONN))

                elif msg_type == MSG_DATA:
                    with self.lock:
                        s = self.conns.get(cid)
                    if s:
                        try:
                            s.sendall(data)
                        except OSError:
                            pass

                elif msg_type == MSG_CLOSE_CONN:
                    with self.lock:
                        s = self.conns.pop(cid, None)
                    if s:
                        try: s.close()
                        except OSError: pass
                    print(f"[-] Conn #{cid} closed")

        except OSError:
            pass
        finally:
            self.running = False
            with self.lock:
                for s in self.conns.values():
                    try: s.close()
                    except OSError: pass
                self.conns.clear()

    # ── main entry ───────────────────────────────────────────────────────
    def run(self):
        banner = f"""
╔══════════════════════════════════════════════╗
║           NoPort Tunnel Client              ║
╠══════════════════════════════════════════════╣
║  Server  : {self.server_host}:{self.server_port:<27}║
║  Local   : {self.local_host}:{self.local_port:<27}║
╚══════════════════════════════════════════════╝
"""
        print(banner)

        # pre-check: can we reach the local service?
        print(f"[*] Checking local service at {self.local_host}:{self.local_port} ...")
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            probe.settimeout(3)
            probe.connect((self.local_host, self.local_port))
            probe.close()
        except OSError as exc:
            print(f"[-] Cannot reach local service: {exc}")
            print("[!] Make sure your service is running first.")
            sys.exit(1)
        print("[+] Local service is reachable.")

        # connect to server control port
        print(f"[*] Connecting to server {self.server_host}:{self.server_port} ...")
        try:
            srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            srv.settimeout(10)
            srv.connect((self.server_host, self.server_port))
            srv.settimeout(None)
        except OSError as exc:
            print(f"[-] Server connection failed: {exc}")
            sys.exit(1)
        print("[+] Connected to server.")

        # request tunnel
        srv.sendall(pack_msg(0, MSG_TUNNEL_REQ, str(self.local_port).encode()))

        cid, mtype, data = recv_msg(srv)
        if mtype != MSG_TUNNEL_RESP:
            print(f"[-] Unexpected response type {mtype}")
            srv.close()
            sys.exit(1)

        text = data.decode()
        if text.startswith('OK:'):
            pub_port = int(text[3:])
        else:
            print(f"[-] Server rejected: {text}")
            srv.close()
            sys.exit(1)

        print()
        print(f"  ╔═══════════════════════════════════════════════╗")
        print(f"  ║  TUNNEL ACTIVE                               ║")
        print(f"  ║  Public : {self.server_host}:{pub_port:<30}║")
        print(f"  ║  Local  : {self.local_host}:{self.local_port:<30}║")
        print(f"  ║  Share the public address with others!       ║")
        print(f"  ╚═══════════════════════════════════════════════╝")
        print()
        print("[*] Forwarding traffic... Press Ctrl+C to stop.")

        try:
            self._server_loop(srv)
        except KeyboardInterrupt:
            pass
        finally:
            print("\n[!] Disconnecting.")
            srv.close()


# ═══════════════════════════════════════════════════════════════════════════════
#  CLI
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        prog='noport',
        description='NoPort — tunnel local ports through a server you can reach',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
examples:
  # Start the server (on your VPS with forwarded ports)
  python3 noport.py server
  python3 noport.py server --control-port 7000 --min-port 7001 --max-port 8000

  # Expose a local web server (174.169.230.116 is default)
  python3 noport.py client --local-port 8080

  # Expose a Minecraft server
  python3 noport.py client --local-port 25565

  # Expose an SSH server on a non-loopback address
  python3 noport.py client --local-port 22 --local-host 192.168.1.50
"""
    )
    sub = parser.add_subparsers(dest='mode')

    # ── server ───────────────────────────────────────────────────────────
    sp = sub.add_parser('server', help='Run tunnel server')
    sp.add_argument('--host', default='0.0.0.0',
                    help='Bind address (default: 0.0.0.0)')
    sp.add_argument('--control-port', type=int, default=DEFAULT_CONTROL_PORT,
                    help=f'Control port (default: {DEFAULT_CONTROL_PORT})')
    sp.add_argument('--min-port', type=int, default=DEFAULT_MIN_PORT,
                    help=f'Lowest public port to allocate (default: {DEFAULT_MIN_PORT})')
    sp.add_argument('--max-port', type=int, default=DEFAULT_MAX_PORT,
                    help=f'Highest public port to allocate (default: {DEFAULT_MAX_PORT})')

    # ── client ───────────────────────────────────────────────────────────
    cp = sub.add_parser('client', help='Run tunnel client')
    cp.add_argument('--server', default=DEFAULT_SERVER_IP,
                    help=f'Server IP or hostname (default: {DEFAULT_SERVER_IP})')
    cp.add_argument('--server-port', type=int, default=DEFAULT_CONTROL_PORT,
                    help=f'Server control port (default: {DEFAULT_CONTROL_PORT})')
    cp.add_argument('--local-port', type=int, required=True,
                    help='Local port to expose')
    cp.add_argument('--local-host', default='127.0.0.1',
                    help='Local service address (default: 127.0.0.1)')

    args = parser.parse_args()

    if args.mode == 'server':
        TunnelServer(
            host=args.host,
            control_port=args.control_port,
            min_port=args.min_port,
            max_port=args.max_port,
        ).run()

    elif args.mode == 'client':
        TunnelClient(
            server_host=args.server,
            server_port=args.server_port,
            local_host=args.local_host,
            local_port=args.local_port,
        ).run()

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()