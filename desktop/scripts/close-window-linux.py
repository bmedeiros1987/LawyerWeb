#!/usr/bin/env python3
# Sends WM_DELETE_WINDOW to the LawyerMind window (what the window close button
# does), to check that closing the app stops the local PostgreSQL cleanly.
import sys, time
from Xlib import display, X, protocol
d = display.Display()
root = d.screen().root
WM_PROTOCOLS = d.intern_atom('WM_PROTOCOLS'); WM_DELETE = d.intern_atom('WM_DELETE_WINDOW')
def walk(w):
    try: name = w.get_wm_name()
    except Exception: name = None
    if name == 'LawyerMind': yield w
    try:
        for c in w.query_tree().children: yield from walk(c)
    except Exception: pass
wins = list(walk(root))
print('janelas:', len(wins))
for w in wins:
    ev = protocol.event.ClientMessage(window=w, client_type=WM_PROTOCOLS, data=(32, [WM_DELETE, X.CurrentTime, 0, 0, 0]))
    w.send_event(ev, event_mask=X.NoEventMask); d.flush()
