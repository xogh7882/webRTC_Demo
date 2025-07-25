package com.ssafy.webrtc_backend.service;


import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.kurento.client.IceCandidate;
import org.kurento.client.KurentoClient;
import org.kurento.client.MediaPipeline;
import org.kurento.client.WebRtcEndpoint;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.WebSocketSession;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentSkipListSet;

@Slf4j
@Service
public class KurentoService {

    @Value("${kurento.client.ws-url}")
    private String kurentoWsUrl;

    private KurentoClient kurentoClient;

    // 방별 미디어 파이프라인 관리
    private final Map<String, MediaPipeline> roomPipelines = new ConcurrentHashMap<>();

    // 사용자별 WebRTC 엔드포인트 관리
    private final Map<String, WebRtcEndpoint> userEndpoints = new ConcurrentHashMap<>();

    // 방별 참가자 목록
    private final Map<String, Set<String>> roomParticipants = new ConcurrentHashMap<>();

    // 세션별 방 정보
    private final Map<String, String> sessionRooms = new ConcurrentHashMap<>();

    @PostConstruct
    public void init() {
        try {
            log.info("Kurento 클라이언트 초기화 시작: {}", kurentoWsUrl);
            kurentoClient = KurentoClient.create(kurentoWsUrl);
            log.info("Kurento 클라이언트 초기화 완료");
        } catch (Exception e) {
            log.error("Kurento 클라이언트 초기화 실패", e);
            throw new RuntimeException("Kurento 연결 실패", e);
        }
    }

    @PreDestroy
    public void cleanup() {
        if (kurentoClient != null) {
            kurentoClient.destroy();
        }
    }

    /**
     * 방 참가 처리
     */
    public void joinRoom(String sessionId, String roomId, WebSocketSession session) {
        try {
            log.info("방 참가 요청: sessionId={}, roomId={}", sessionId, roomId);

            // 1. 방의 미디어 파이프라인 생성 또는 가져오기
            MediaPipeline pipeline = getOrCreatePipeline(roomId);

            // 2. 사용자용 WebRTC 엔드포인트 생성
            WebRtcEndpoint endpoint = new WebRtcEndpoint.Builder(pipeline).build();
            userEndpoints.put(sessionId, endpoint);

            // 3. ICE Candidate 리스너 등록
            endpoint.addIceCandidateFoundListener(event -> {
                try {
                    sendIceCandidate(session, event.getCandidate());
                } catch (Exception e) {
                    log.error("ICE candidate 전송 실패", e);
                }
            });

            // 4. 방 참가자 목록에 추가
            roomParticipants.computeIfAbsent(roomId, k -> new ConcurrentSkipListSet<>())
                    .add(sessionId);
            sessionRooms.put(sessionId, roomId);

            // 5. 기존 참가자들과 연결
            connectToExistingParticipants(roomId, sessionId, endpoint);

            log.info("방 참가 완료: sessionId={}, roomId={}", sessionId, roomId);

        } catch (Exception e) {
            log.error("방 참가 처리 실패: sessionId={}, roomId={}", sessionId, roomId, e);
            throw new RuntimeException("방 참가 실패", e);
        }
    }

    /**
     * Offer 처리
     */
    public String processOffer(String sessionId, String sdpOffer) {
        try {
            log.info("Offer 처리 시작: sessionId={}", sessionId);

            WebRtcEndpoint endpoint = userEndpoints.get(sessionId);
            if (endpoint == null) {
                throw new RuntimeException("사용자 엔드포인트 없음: " + sessionId);
            }

            // SDP Offer 처리하고 Answer 생성
            String sdpAnswer = endpoint.processOffer(sdpOffer);

            // ICE gathering 시작
            endpoint.gatherCandidates();

            log.info("Offer 처리 완료: sessionId={}", sessionId);
            return sdpAnswer;

        } catch (Exception e) {
            log.error("Offer 처리 실패: sessionId={}", sessionId, e);
            throw new RuntimeException("Offer 처리 실패", e);
        }
    }

    /**
     * ICE Candidate 추가
     */
    public void addIceCandidate(String sessionId, JsonNode candidateJson) {
        try {
            WebRtcEndpoint endpoint = userEndpoints.get(sessionId);
            if (endpoint == null) {
                log.warn("ICE candidate 처리 실패 - 엔드포인트 없음: {}", sessionId);
                return;
            }

            IceCandidate candidate = new IceCandidate(
                    candidateJson.get("candidate").asText(),
                    candidateJson.get("sdpMid").asText(),
                    candidateJson.get("sdpMLineIndex").asInt()
            );

            endpoint.addIceCandidate(candidate);
            log.debug("ICE candidate 추가 완료: sessionId={}", sessionId);

        } catch (Exception e) {
            log.error("ICE candidate 처리 실패: sessionId={}", sessionId, e);
        }
    }

    /**
     * 방 나가기
     */
    public void leaveRoom(String sessionId) {
        try {
            log.info("방 나가기: sessionId={}", sessionId);

            String roomId = sessionRooms.get(sessionId);
            if (roomId == null) {
                return;
            }

            // 1. 엔드포인트 정리
            WebRtcEndpoint endpoint = userEndpoints.remove(sessionId);
            if (endpoint != null) {
                endpoint.release();
            }

            // 2. 방 참가자 목록에서 제거
            Set<String> participants = roomParticipants.get(roomId);
            if (participants != null) {
                participants.remove(sessionId);

                // 방이 비었으면 파이프라인 정리
                if (participants.isEmpty()) {
                    MediaPipeline pipeline = roomPipelines.remove(roomId);
                    if (pipeline != null) {
                        pipeline.release();
                    }
                    roomParticipants.remove(roomId);
                }
            }

            sessionRooms.remove(sessionId);

            log.info("방 나가기 완료: sessionId={}", sessionId);

        } catch (Exception e) {
            log.error("방 나가기 실패: sessionId={}", sessionId, e);
        }
    }

    // === 내부 헬퍼 메서드들 ===

    private MediaPipeline getOrCreatePipeline(String roomId) {
        return roomPipelines.computeIfAbsent(roomId, k -> {
            log.info("새 미디어 파이프라인 생성: roomId={}", roomId);
            return kurentoClient.createMediaPipeline();
        });
    }

    private void connectToExistingParticipants(String roomId, String newSessionId, WebRtcEndpoint newEndpoint) {
        Set<String> participants = roomParticipants.get(roomId);
        if (participants == null) return;

        for (String existingSessionId : participants) {
            if (!existingSessionId.equals(newSessionId)) {
                WebRtcEndpoint existingEndpoint = userEndpoints.get(existingSessionId);
                if (existingEndpoint != null) {
                    // 양방향 연결: 기존 → 새 참가자, 새 참가자 → 기존
                    existingEndpoint.connect(newEndpoint);
                    newEndpoint.connect(existingEndpoint);

                    log.info("참가자 연결 완료: {} ↔ {}", existingSessionId, newSessionId);
                }
            }
        }
    }

    private void sendIceCandidate(WebSocketSession session, IceCandidate candidate) throws Exception {
        if (session.isOpen()) {
            String message = String.format(
                    "{\"type\":\"ice-candidate\",\"data\":{\"candidate\":\"%s\",\"sdpMid\":\"%s\",\"sdpMLineIndex\":%d}}",
                    candidate.getCandidate(), candidate.getSdpMid(), candidate.getSdpMLineIndex()
            );
            session.sendMessage(new org.springframework.web.socket.TextMessage(message));
        }
    }
}