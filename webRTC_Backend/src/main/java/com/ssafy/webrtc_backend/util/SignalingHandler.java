
package com.ssafy.webrtc_backend.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ssafy.webrtc_backend.service.KurentoService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
@RequiredArgsConstructor
public class SignalingHandler extends TextWebSocketHandler {

    private static KurentoService kurentoService;

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.put(session.getId(), session);
        log.info("WebSocket 연결 생성: sessionId={}", session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        try {
            JsonNode data = objectMapper.readTree(message.getPayload());
            String type = data.get("type").asText();
            String sessionId = session.getId();

            log.info("메시지 수신: type={}, sessionId={}", type, sessionId);

            switch (type) {
                case "join":
                    handleJoin(session, data);
                    break;
                case "offer":
                    handleOffer(session, data);
                    break;
                case "ice-candidate":
                    handleIceCandidate(session, data);
                    break;
                case "leave":
                    handleLeave(session);
                    break;
                default:
                    log.warn("알 수 없는 메시지 타입: {}", type);
            }
        } catch (Exception e) {
            log.error("메시지 처리 에러: sessionId={}", session.getId(), e);
            sendErrorMessage(session, "메시지 처리 실패: " + e.getMessage());
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String sessionId = session.getId();
        log.info("WebSocket 연결 종료: sessionId={}, status={}", sessionId, status);

        // 정리 작업
        sessions.remove(sessionId);
        kurentoService.leaveRoom(sessionId);

        // 다른 참가자들에게 알림
        notifyParticipantLeft(sessionId);
    }

    // === 메시지 핸들러들 ===

    private void handleJoin(WebSocketSession session, JsonNode data) throws Exception {
        String roomId = data.has("roomId") ? data.get("roomId").asText() : "default-room";
        String sessionId = session.getId();

        log.info("방 참가 요청: sessionId={}, roomId={}", sessionId, roomId);

        try {
            // Kurento 서비스로 방 참가 처리
            kurentoService.joinRoom(sessionId, roomId, session);

            // 성공 응답 전송
            ObjectNode response = objectMapper.createObjectNode();
            response.put("type", "joined");
            response.put("roomId", roomId);
            response.put("sessionId", sessionId);

            session.sendMessage(new TextMessage(response.toString()));

            // 다른 참가자들에게 새 참가자 알림
            notifyParticipantJoined(roomId, sessionId, session);

        } catch (Exception e) {
            log.error("방 참가 실패: sessionId={}, roomId={}", sessionId, roomId, e);
            sendErrorMessage(session, "방 참가 실패: " + e.getMessage());
        }
    }

    private void handleOffer(WebSocketSession session, JsonNode data) throws Exception {
        String sessionId = session.getId();
        String sdpOffer = data.get("data").get("sdp").asText();

        log.info("Offer 처리 요청: sessionId={}", sessionId);

        try {
            // Kurento로 SDP Offer 처리
            String sdpAnswer = kurentoService.processOffer(sessionId, sdpOffer);

            // Answer 응답 전송
            ObjectNode response = objectMapper.createObjectNode();
            response.put("type", "answer");

            ObjectNode answerData = objectMapper.createObjectNode();
            answerData.put("type", "answer");
            answerData.put("sdp", sdpAnswer);
            response.set("data", answerData);

            session.sendMessage(new TextMessage(response.toString()));

            log.info("Answer 전송 완료: sessionId={}", sessionId);

        } catch (Exception e) {
            log.error("Offer 처리 실패: sessionId={}", sessionId, e);
            sendErrorMessage(session, "Offer 처리 실패: " + e.getMessage());
        }
    }

    private void handleIceCandidate(WebSocketSession session, JsonNode data) throws Exception {
        String sessionId = session.getId();
        JsonNode candidateData = data.get("data");

        log.debug("ICE Candidate 처리: sessionId={}", sessionId);

        try {
            kurentoService.addIceCandidate(sessionId, candidateData);

        } catch (Exception e) {
            log.error("ICE Candidate 처리 실패: sessionId={}", sessionId, e);
        }
    }

    private void handleLeave(WebSocketSession session) throws Exception {
        String sessionId = session.getId();

        log.info("방 나가기 요청: sessionId={}", sessionId);

        kurentoService.leaveRoom(sessionId);
        notifyParticipantLeft(sessionId);

        // 나가기 확인 응답
        ObjectNode response = objectMapper.createObjectNode();
        response.put("type", "left");
        response.put("sessionId", sessionId);

        session.sendMessage(new TextMessage(response.toString()));
    }

    // === 알림 메서드들 ===

    private void notifyParticipantJoined(String roomId, String newSessionId, WebSocketSession newSession) {
        // 실제로는 방별 참가자 목록을 관리해야 하지만,
        // 여기서는 간단히 모든 세션에 알림 (실제 구현에서는 방별로 필터링 필요)

        ObjectNode notification = objectMapper.createObjectNode();
        notification.put("type", "user-joined");
        notification.put("sessionId", newSessionId);

        sessions.values().forEach(session -> {
            if (!session.getId().equals(newSessionId) && session.isOpen()) {
                try {
                    session.sendMessage(new TextMessage(notification.toString()));
                } catch (Exception e) {
                    log.error("참가자 알림 전송 실패", e);
                }
            }
        });
    }

    private void notifyParticipantLeft(String leftSessionId) {
        ObjectNode notification = objectMapper.createObjectNode();
        notification.put("type", "user-left");
        notification.put("sessionId", leftSessionId);

        sessions.values().forEach(session -> {
            if (session.isOpen()) {
                try {
                    session.sendMessage(new TextMessage(notification.toString()));
                } catch (Exception e) {
                    log.error("참가자 나감 알림 전송 실패", e);
                }
            }
        });
    }

    private void sendErrorMessage(WebSocketSession session, String error) {
        try {
            ObjectNode errorResponse = objectMapper.createObjectNode();
            errorResponse.put("type", "error");
            errorResponse.put("message", error);

            session.sendMessage(new TextMessage(errorResponse.toString()));
        } catch (Exception e) {
            log.error("에러 메시지 전송 실패", e);
        }
    }
}