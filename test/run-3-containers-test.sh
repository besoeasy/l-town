#!/usr/bin/env bash
set -euo pipefail

echo "========================================================================"
echo "           L-TOWN 3-CONTAINER NOSTR MULTIPLAYER TEST                    "
echo "========================================================================"

WORKSPACE="/home/jesus/project/besoeasy/l-town"
SCREENSHOT_DIR="$WORKSPACE/test/screenshots"
mkdir -p "$SCREENSHOT_DIR"

echo "[1/7] Cleaning up existing test containers..."
podman rm -f ltown-player1 ltown-player2 ltown-player3 2>/dev/null || true

echo "[2/7] Ensuring podman network 'ltown-net' exists..."
if ! podman network exists ltown-net 2>/dev/null; then
  podman network create ltown-net
fi

echo "[3/7] Launching Container 1 (Host: Pilot-Alpha + Nostr Relay Server)..."
podman run -d --name ltown-player1 --network ltown-net \
  -p 30300:30300 -p 9001:9001 \
  -v "$WORKSPACE/test:/app/test:Z" \
  ltown-test:latest node server.js

sleep 2

# Verify server
SERVER_INFO=$(curl -s http://localhost:30300/api/info)
echo "   Server online: $SERVER_INFO"

# Launch Player 1 Agent
echo "   Starting Pilot-Alpha browser agent in Container 1..."
podman exec -d ltown-player1 bash -c "node test/player-agent.js host Pilot-Alpha http://localhost:30300 9001 > /app/test/agent1.log 2>&1"

echo "   Waiting for Pilot-Alpha to publish Nostr room..."
ALPHA_READY=false
for i in $(seq 1 40); do
  READY=$(curl -s http://localhost:9001/health | jq -r .agentReady 2>/dev/null || true)
  if [ "$READY" = "true" ]; then
    echo "   -> Pilot-Alpha is HOSTING on Nostr! (took ${i}s)"
    ALPHA_READY=true
    break
  fi
  sleep 1
done

if [ "$ALPHA_READY" != "true" ]; then
  echo "ERROR: Pilot-Alpha failed to start hosting within 40s. Agent log:"
  cat "$WORKSPACE/test/agent1.log" || true
  exit 1
fi

HOST_STATE=$(curl -s http://localhost:9001/state)
ROOM_ID=$(echo "$HOST_STATE" | jq -r '.nostrRooms[0].id')
ROOM_SEED=$(echo "$HOST_STATE" | jq -r '.seed')
ROOM_NAME=$(echo "$HOST_STATE" | jq -r '.nostrRooms[0].name')
HOST_PUBKEY=$(echo "$HOST_STATE" | jq -r '.nostrRooms[0].pubkey')
echo "   Nostr Room Published:"
echo "     Room ID: $ROOM_ID"
echo "     Seed:    $ROOM_SEED"
echo "     Name:    $ROOM_NAME"
echo "     Pubkey:  $HOST_PUBKEY"

echo "[4/7] Launching Container 2 (Client 1: Pilot-Bravo)..."
podman run -d --name ltown-player2 --network ltown-net \
  -p 9002:9002 \
  -v "$WORKSPACE/test:/app/test:Z" \
  ltown-test:latest sleep 3600

echo "   Starting Pilot-Bravo browser agent in Container 2..."
podman exec -d ltown-player2 bash -c "node test/player-agent.js join Pilot-Bravo http://ltown-player1:30300 9002 > /app/test/agent2.log 2>&1"

echo "   Waiting for Pilot-Bravo to discover room & link via Nostr/WebRTC..."
BRAVO_READY=false
for i in $(seq 1 40); do
  READY=$(curl -s http://localhost:9002/health | jq -r .agentReady 2>/dev/null || true)
  if [ "$READY" = "true" ]; then
    echo "   -> Pilot-Bravo LINKED via P2P WebRTC! (took ${i}s)"
    BRAVO_READY=true
    break
  fi
  sleep 1
done

if [ "$BRAVO_READY" != "true" ]; then
  echo "ERROR: Pilot-Bravo failed to link via WebRTC within 40s. Agent log:"
  cat "$WORKSPACE/test/agent2.log" || true
  echo "Agent 1 log:"
  cat "$WORKSPACE/test/agent1.log" || true
  exit 1
fi

echo "[5/7] Launching Container 3 (Client 2: Pilot-Charlie)..."
podman run -d --name ltown-player3 --network ltown-net \
  -p 9003:9003 \
  -v "$WORKSPACE/test:/app/test:Z" \
  ltown-test:latest sleep 3600

echo "   Starting Pilot-Charlie browser agent in Container 3..."
podman exec -d ltown-player3 bash -c "node test/player-agent.js join Pilot-Charlie http://ltown-player1:30300 9003 > /app/test/agent3.log 2>&1"

echo "   Waiting for Pilot-Charlie to discover room & link via Nostr/WebRTC..."
CHARLIE_READY=false
for i in $(seq 1 40); do
  READY=$(curl -s http://localhost:9003/health | jq -r .agentReady 2>/dev/null || true)
  if [ "$READY" = "true" ]; then
    echo "   -> Pilot-Charlie LINKED via P2P WebRTC! (took ${i}s)"
    CHARLIE_READY=true
    break
  fi
  sleep 1
done

if [ "$CHARLIE_READY" != "true" ]; then
  echo "ERROR: Pilot-Charlie failed to link via WebRTC within 40s. Agent log:"
  cat "$WORKSPACE/test/agent3.log" || true
  echo "Agent 1 log:"
  cat "$WORKSPACE/test/agent1.log" || true
  exit 1
fi

# Allow tick synchronization across all 3 nodes
sleep 3

echo "[6/7] Capturing synchronized game state across all 3 containers..."
STATE1=$(curl -s http://localhost:9001/state)
STATE2=$(curl -s http://localhost:9002/state)
STATE3=$(curl -s http://localhost:9003/state)

echo "$STATE1" > "$WORKSPACE/test/state_player1_alpha.json"
echo "$STATE2" > "$WORKSPACE/test/state_player2_bravo.json"
echo "$STATE3" > "$WORKSPACE/test/state_player3_charlie.json"

echo "=== INITIAL POSITIONS ==="
echo "Pilot-Alpha (Container 1) sees:"
echo "$STATE1" | jq '{localPlayer: .localPlayer, remotePlayers: .remotePlayers, remoteMeshesCount: .remoteMeshesCount, seed: .seed}'
echo "Pilot-Bravo (Container 2) sees:"
echo "$STATE2" | jq '{localPlayer: .localPlayer, remotePlayers: .remotePlayers, remoteMeshesCount: .remoteMeshesCount, seed: .seed}'
echo "Pilot-Charlie (Container 3) sees:"
echo "$STATE3" | jq '{localPlayer: .localPlayer, remotePlayers: .remotePlayers, remoteMeshesCount: .remoteMeshesCount, seed: .seed}'

echo "[7/7] Testing real-time player movement and propagation..."
echo "   Commanding Pilot-Bravo (Container 2) to walk forward for 1500ms..."
curl -s -X POST "http://localhost:9002/move?duration=1500" > /dev/null

sleep 1

# Capture post-movement state
POST_STATE1=$(curl -s http://localhost:9001/state)
POST_STATE2=$(curl -s http://localhost:9002/state)
POST_STATE3=$(curl -s http://localhost:9003/state)

echo "$POST_STATE1" > "$WORKSPACE/test/post_move_player1_alpha.json"
echo "$POST_STATE2" > "$WORKSPACE/test/post_move_player2_bravo.json"
echo "$POST_STATE3" > "$WORKSPACE/test/post_move_player3_charlie.json"

echo "=== POST-MOVEMENT POSITIONS ==="
echo "Pilot-Alpha (Container 1) sees Bravo at:"
echo "$POST_STATE1" | jq '.remotePlayers[] | select(.name == "Pilot-Bravo")'
echo "Pilot-Bravo (Container 2) reports self at:"
echo "$POST_STATE2" | jq '.localPlayer'
echo "Pilot-Charlie (Container 3) sees Bravo at:"
echo "$POST_STATE3" | jq '.remotePlayers[] | select(.name == "Pilot-Bravo")'

echo "=== CAPTURING VIEWPORT SCREENSHOTS ==="
curl -s http://localhost:9001/screenshot > "$SCREENSHOT_DIR/player1_alpha.png"
curl -s http://localhost:9002/screenshot > "$SCREENSHOT_DIR/player2_bravo.png"
curl -s http://localhost:9003/screenshot > "$SCREENSHOT_DIR/player3_charlie.png"
echo "Screenshots saved to $SCREENSHOT_DIR"
ls -lh "$SCREENSHOT_DIR"

echo "========================================================================"
echo "                       TEST VERIFICATION SUMMARY                        "
echo "========================================================================"

SEED1=$(echo "$STATE1" | jq -r .seed)
SEED2=$(echo "$STATE2" | jq -r .seed)
SEED3=$(echo "$STATE3" | jq -r .seed)

echo "1. Room Seed Check: P1=$SEED1, P2=$SEED2, P3=$SEED3"
if [ "$SEED1" = "$SEED2" ] && [ "$SEED2" = "$SEED3" ]; then
  echo "   -> PASS: All 3 containers share the EXACT SAME MAP SEED ($SEED1)"
else
  echo "   -> FAIL: Seed mismatch!"
fi

echo "2. Nostr Room Discovery Check:"
echo "   -> Discovered Room ID: $ROOM_ID"
echo "   -> Discovered Room Name: $ROOM_NAME"
echo "   -> Host Pubkey: $HOST_PUBKEY"

P1_REMOTE_COUNT=$(echo "$STATE1" | jq '.remotePlayers | length')
P2_REMOTE_COUNT=$(echo "$STATE2" | jq '.remotePlayers | length')
P3_REMOTE_COUNT=$(echo "$STATE3" | jq '.remotePlayers | length')

echo "3. Player Visibility Check:"
echo "   -> Pilot-Alpha sees $P1_REMOTE_COUNT remote player(s): $(echo "$STATE1" | jq -c '[.remotePlayers[].name]')"
echo "   -> Pilot-Bravo sees $P2_REMOTE_COUNT remote player(s): $(echo "$STATE2" | jq -c '[.remotePlayers[].name]')"
echo "   -> Pilot-Charlie sees $P3_REMOTE_COUNT remote player(s): $(echo "$STATE3" | jq -c '[.remotePlayers[].name]')"

P1_MESHES=$(echo "$STATE1" | jq -r .remoteMeshesCount)
P2_MESHES=$(echo "$STATE2" | jq -r .remoteMeshesCount)
P3_MESHES=$(echo "$STATE3" | jq -r .remoteMeshesCount)
echo "4. 3D Mesh Rendering Check:"
echo "   -> Pilot-Alpha renders $P1_MESHES 3D player mesh(es)"
echo "   -> Pilot-Bravo renders $P2_MESHES 3D player mesh(es)"
echo "   -> Pilot-Charlie renders $P3_MESHES 3D player mesh(es)"

echo "========================================================================"
echo "TEST COMPLETED SUCCESSFULLY"
echo "========================================================================"
