// SignalingHandler.java - Kurento 완전 호환 버전

package com.ssafy.webrtc_backend.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ssafy.webrtc_backend.service.KurentoService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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

    private final KurentoService kurentoService;
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
                case "call":
                    handleCall(session);
                    break;
                case "processOffer":
                    handleProcessOffer(session, data);
                    break;
                case "processAnswer":
                    handleProcessAnswer(session, data);
                    break;
                case "onIceCandidate":
                    handleIceCandidate(session, data);
                    break;
                case "stop":
                    handleStop(session);
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
    }

    // === 메시지 핸들러들 ===

    private void handleJoin(WebSocketSession session, JsonNode data) throws Exception {
        String roomId = data.has("roomId") ? data.get("roomId").asText() : "default";
        String sessionId = session.getId();

        log.info("방 참가 요청: sessionId={}, roomId={}", sessionId, roomId);

        try {
            // Kurento 서비스를 통해 방 참가
            kurentoService.joinRoom(sessionId, roomId, session);

            // 성공 응답
            ObjectNode response = objectMapper.createObjectNode();
            response.put("type", "joined");
            response.put("roomId", roomId);
            session.sendMessage(new TextMessage(response.toString()));

            log.info("방 참가 완료: sessionId={}, roomId={}", sessionId, roomId);

        } catch (Exception e) {
            log.error("방 참가 실패: sessionId={}, roomId={}", sessionId, roomId, e);
            sendErrorMessage(session, "방 참가 실패: " + e.getMessage());
        }
    }

    private void handleCall(WebSocketSession session) throws Exception {
        String sessionId = session.getId();
        log.info("통화 요청: sessionId={}", sessionId);

        try {
            // Kurento 서비스를 통해 통화 시작
            String sdpOffer = kurentoService.startCommunication(sessionId);

            if (sdpOffer != null) {
                // SDP Offer를 클라이언트에게 전송
                ObjectNode response = objectMapper.createObjectNode();
                response.put("type", "startCommunication");
                response.put("sdpOffer", sdpOffer);
                session.sendMessage(new TextMessage(response.toString()));

                log.info("SDP Offer 전송 완료: sessionId={}", sessionId);
            }

        } catch (Exception e) {
            log.error("통화 시작 실패: sessionId={}", sessionId, e);
            sendErrorMessage(session, "통화 시작 실패: " + e.getMessage());
        }
    }

    private void handleProcessOffer(WebSocketSession session, JsonNode data) throws Exception {
        String sessionId = session.getId();
        String sdpOffer = data.get("sdpOffer").asText();

        log.info("SDP Offer 처리: sessionId={}", sessionId);

        try {
            // Kurento 서비스를 통해 SDP Offer 처리
            String sdpAnswer = kurentoService.processOffer(sessionId, sdpOffer);

            if (sdpAnswer != null) {
                // SDP Answer를 클라이언트에게 전송
                ObjectNode response = objectMapper.createObjectNode();
                response.put("type", "processAnswer");
                response.put("sdpAnswer", sdpAnswer);
                session.sendMessage(new TextMessage(response.toString()));

                log.info("SDP Answer 전송 완료: sessionId={}", sessionId);
            }

        } catch (Exception e) {
            log.error("SDP Offer 처리 실패: sessionId={}", sessionId, e);
            sendErrorMessage(session, "Offer 처리 실패: " + e.getMessage());
        }
    }

    private void handleProcessAnswer(WebSocketSession session, JsonNode data) throws Exception {
        String sessionId = session.getId();
        String sdpAnswer = data.get("sdpAnswer").asText();

        log.info("SDP Answer 처리: sessionId={}", sessionId);

        try {
            // Kurento 서비스를 통해 SDP Answer 처리
            kurentoService.processAnswer(sessionId, sdpAnswer);
            log.info("SDP Answer 처리 완료: sessionId={}", sessionId);

        } catch (Exception e) {
            log.error("SDP Answer 처리 실패: sessionId={}", sessionId, e);
            sendErrorMessage(session, "Answer 처리 실패: " + e.getMessage());
        }
    }

    private void handleIceCandidate(WebSocketSession session, JsonNode data) throws Exception {
        String sessionId = session.getId();
        JsonNode candidateData = data.get("candidate");

        log.debug("ICE Candidate 처리: sessionId={}", sessionId);

        try {
            // Kurento 서비스를 통해 ICE Candidate 처리
            kurentoService.addIceCandidate(sessionId, candidateData);
            log.debug("ICE Candidate 처리 완료: sessionId={}", sessionId);

        } catch (Exception e) {
            log.error("ICE Candidate 처리 실패: sessionId={}", sessionId, e);
            // ICE Candidate 실패는 연결을 중단시키지 않음
        }
    }

    private void handleStop(WebSocketSession session) throws Exception {
        String sessionId = session.getId();
        log.info("통화 종료 요청: sessionId={}", sessionId);

        try {
            // Kurento 서비스를 통해 통화 종료
            kurentoService.stopCommunication(sessionId);

            // 종료 확인 응답
            ObjectNode response = objectMapper.createObjectNode();
            response.put("type", "stopCommunication");
            session.sendMessage(new TextMessage(response.toString()));

            log.info("통화 종료 완료: sessionId={}", sessionId);

        } catch (Exception e) {
            log.error("통화 종료 실패: sessionId={}", sessionId, e);
            sendErrorMessage(session, "통화 종료 실패: " + e.getMessage());
        }
    }

    // === 유틸리티 메서드들 ===

    /**
     * ICE Candidate를 클라이언트에게 전송
     */
    public void sendIceCandidate(String sessionId, JsonNode candidate) {
        WebSocketSession session = sessions.get(sessionId);
        if (session != null && session.isOpen()) {
            try {
                ObjectNode message = objectMapper.createObjectNode();
                message.put("type", "iceCandidate");
                message.set("candidate", candidate);

                session.sendMessage(new TextMessage(message.toString()));
                log.debug("ICE Candidate 전송 완료: sessionId={}", sessionId);

            } catch (Exception e) {
                log.error("ICE Candidate 전송 실패: sessionId={}", sessionId, e);
            }
        } else {
            log.warn("세션이 없거나 닫혀있음: sessionId={}", sessionId);
        }
    }

    /**
     * 에러 메시지 전송
     */
    private void sendErrorMessage(WebSocketSession session, String error) {
        try {
            ObjectNode errorResponse = objectMapper.createObjectNode();
            errorResponse.put("type", "error");
            errorResponse.put("message", error);

            session.sendMessage(new TextMessage(errorResponse.toString()));
            log.info("에러 메시지 전송: {}", error);

        } catch (Exception e) {
            log.error("에러 메시지 전송 실패", e);
        }
    }

    /**
     * 특정 세션에게 메시지 전송
     */
    public void sendMessage(String sessionId, ObjectNode message) {
        WebSocketSession session = sessions.get(sessionId);
        if (session != null && session.isOpen()) {
            try {
                session.sendMessage(new TextMessage(message.toString()));
                log.debug("메시지 전송 완료: sessionId={}, type={}",
                        sessionId, message.get("type").asText());

            } catch (Exception e) {
                log.error("메시지 전송 실패: sessionId={}", sessionId, e);
            }
        } else {
            log.warn("세션이 없거나 닫혀있음: sessionId={}", sessionId);
        }
    }

    /**
     * 연결된 모든 세션 정보 반환
     */
    public int getConnectedSessionCount() {
        return sessions.size();
    }
}