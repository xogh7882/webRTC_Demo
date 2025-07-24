package com.ssafy.webrtc_backend.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class SignalingHandler extends TextWebSocketHandler {

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, String> rooms = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.put(session.getId(), session);
        System.out.println("연결됨: " + session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode data = mapper.readTree(message.getPayload());
            String type = data.get("type").asText();
            String sessionId = session.getId();

            System.out.println("메시지 타입: " + type + " from " + sessionId);

            switch (type) {
                case "join":
                    handleJoin(session, data);
                    break;
                case "offer":
                case "answer":
                case "ice-candidate":
                    handleSignaling(session, data);
                    break;
                case "leave":
                    handleLeave(session);
                    break;
            }
        } catch (Exception e) {
            System.err.println("메시지 처리 에러: " + e.getMessage());
        }
    }

    private void handleJoin(WebSocketSession session, JsonNode data) throws Exception {
        String roomId = data.has("roomId") ? data.get("roomId").asText() : "default";
        String sessionId = session.getId();

        rooms.put(sessionId, roomId);

        ObjectMapper mapper = new ObjectMapper();
        ObjectNode response = mapper.createObjectNode();
        response.put("type", "joined");
        response.put("sessionId", sessionId);
        response.put("roomId", roomId);

        session.sendMessage(new TextMessage(response.toString()));

        for (Map.Entry<String, String> entry : rooms.entrySet()) {
            String otherSessionId = entry.getKey();
            String otherRoomId = entry.getValue();

            if (!otherSessionId.equals(sessionId) && otherRoomId.equals(roomId)) {
                WebSocketSession otherSession = sessions.get(otherSessionId);
                if (otherSession != null && otherSession.isOpen()) {
                    ObjectNode notification = mapper.createObjectNode();
                    notification.put("type", "user-joined");
                    notification.put("sessionId", sessionId);
                    otherSession.sendMessage(new TextMessage(notification.toString()));
                }
            }
        }
    }

    private void handleSignaling(WebSocketSession session, JsonNode data) throws Exception {
        String sessionId = session.getId();
        String roomId = rooms.get(sessionId);

        if (roomId == null) return;

        for (Map.Entry<String, String> entry : rooms.entrySet()) {
            String otherSessionId = entry.getKey();
            String otherRoomId = entry.getValue();

            if (!otherSessionId.equals(sessionId) && otherRoomId.equals(roomId)) {
                WebSocketSession otherSession = sessions.get(otherSessionId);
                if (otherSession != null && otherSession.isOpen()) {
                    ObjectMapper mapper = new ObjectMapper();
                    ObjectNode message = mapper.createObjectNode();
                    message.put("type", data.get("type").asText());
                    message.put("sessionId", sessionId);
                    message.set("data", data.get("data"));
                    otherSession.sendMessage(new TextMessage(message.toString()));
                }
            }
        }
    }

    private void handleLeave(WebSocketSession session) {
        String sessionId = session.getId();
        String roomId = rooms.get(sessionId);

        if (roomId != null) {
            rooms.remove(sessionId);

            for (Map.Entry<String, String> entry : rooms.entrySet()) {
                String otherSessionId = entry.getKey();
                String otherRoomId = entry.getValue();

                if (otherRoomId.equals(roomId)) {
                    WebSocketSession otherSession = sessions.get(otherSessionId);
                    if (otherSession != null && otherSession.isOpen()) {
                        try {
                            ObjectMapper mapper = new ObjectMapper();
                            ObjectNode message = mapper.createObjectNode();
                            message.put("type", "user-left");
                            message.put("sessionId", sessionId);
                            otherSession.sendMessage(new TextMessage(message.toString()));
                        } catch (Exception e) {
                            System.err.println("사용자 떠남 알림 에러: " + e.getMessage());
                        }
                    }
                }
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        handleLeave(session);
        sessions.remove(session.getId());
        System.out.println("연결 종료: " + session.getId());
    }
}