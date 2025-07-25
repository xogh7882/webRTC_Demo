// KurentoService.java - 완전한 구현

package com.ssafy.webrtc_backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.webrtc_backend.util.SignalingHandler;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.kurento.client.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
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

    @Autowired
    @Lazy
    private SignalingHandler signalingHandler;

    private KurentoClient kurentoClient;
    private final ObjectMapper objectMapper = new ObjectMapper();

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
        // 모든 엔드포인트 정리
        userEndpoints.values().forEach(endpoint -> {
            try {
                endpoint.release();
            } catch (Exception e) {
                log.warn("엔드포인트 정리 중 오류", e);
            }
        });
        userEndpoints.clear();

        // 모든 파이프라인 정리
        roomPipelines.values().forEach(pipeline -> {
            try {
                pipeline.release();
            } catch (Exception e) {
                log.warn("파이프라인 정리 중 오류", e);
            }
        });
        roomPipelines.clear();

        // Kurento 클라이언트 정리
        if (kurentoClient != null) {
            kurentoClient.destroy();
        }

        log.info("KurentoService 정리 완료");
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

            // 3. ICE Candidate 리스너 등록
            endpoint.addIceCandidateFoundListener(event -> {
                try {
                    IceCandidate candidate = event.getCandidate();
                    sendIceCandidateToClient(sessionId, candidate);
                } catch (Exception e) {
                    log.error("ICE Candidate 전송 실패: sessionId={}", sessionId, e);
                }
            });

            // 4. 엔드포인트 저장
            userEndpoints.put(sessionId, endpoint);

            // 5. 방 참가자 목록에 추가
            roomParticipants.computeIfAbsent(roomId, k -> new ConcurrentSkipListSet<>())
                    .add(sessionId);
            sessionRooms.put(sessionId, roomId);

            // 6. 기존 참가자들과 연결
            connectToExistingParticipants(roomId, sessionId, endpoint);

            log.info("방 참가 완료: sessionId={}, roomId={}, 총 참가자={}",
                    sessionId, roomId, roomParticipants.get(roomId).size());

        } catch (Exception e) {
            log.error("방 참가 처리 실패: sessionId={}, roomId={}", sessionId, roomId, e);
            throw new RuntimeException("방 참가 실패", e);
        }
    }

    /**
     * 통화 시작 (SDP Offer 생성)
     */
    public String startCommunication(String sessionId) {
        try {
            log.info("통화 시작: sessionId={}", sessionId);

            WebRtcEndpoint endpoint = userEndpoints.get(sessionId);
            if (endpoint == null) {
                throw new RuntimeException("엔드포인트를 찾을 수 없습니다: " + sessionId);
            }

            // SDP Offer 생성
            String sdpOffer = endpoint.generateOffer();
            log.info("SDP Offer 생성 완료: sessionId={}", sessionId);

            return sdpOffer;

        } catch (Exception e) {
            log.error("통화 시작 실패: sessionId={}", sessionId, e);
            throw new RuntimeException("통화 시작 실패", e);
        }
    }

    /**
     * SDP Offer 처리 (SDP Answer 생성)
     */
    public String processOffer(String sessionId, String sdpOffer) {
        try {
            log.info("SDP Offer 처리: sessionId={}", sessionId);

            WebRtcEndpoint endpoint = userEndpoints.get(sessionId);
            if (endpoint == null) {
                throw new RuntimeException("엔드포인트를 찾을 수 없습니다: " + sessionId);
            }

            // SDP Answer 생성
            String sdpAnswer = endpoint.processOffer(sdpOffer);

            // 미디어 플로우 시작
            endpoint.gatherCandidates();

            log.info("SDP Answer 생성 완료: sessionId={}", sessionId);
            return sdpAnswer;

        } catch (Exception e) {
            log.error("SDP Offer 처리 실패: sessionId={}", sessionId, e);
            throw new RuntimeException("Offer 처리 실패", e);
        }
    }

    /**
     * SDP Answer 처리
     */
    public void processAnswer(String sessionId, String sdpAnswer) {
        try {
            log.info("SDP Answer 처리: sessionId={}", sessionId);

            WebRtcEndpoint endpoint = userEndpoints.get(sessionId);
            if (endpoint == null) {
                throw new RuntimeException("엔드포인트를 찾을 수 없습니다: " + sessionId);
            }

            // SDP Answer 처리
            endpoint.processAnswer(sdpAnswer);

            // 미디어 플로우 시작
            endpoint.gatherCandidates();

            log.info("SDP Answer 처리 완료: sessionId={}", sessionId);

        } catch (Exception e) {
            log.error("SDP Answer 처리 실패: sessionId={}", sessionId, e);
            throw new RuntimeException("Answer 처리 실패", e);
        }
    }

    /**
     * ICE Candidate 추가
     */
    public void addIceCandidate(String sessionId, JsonNode candidateData) {
        try {
            WebRtcEndpoint endpoint = userEndpoints.get(sessionId);
            if (endpoint == null) {
                log.warn("엔드포인트를 찾을 수 없음, ICE Candidate 무시: sessionId={}", sessionId);
                return;
            }

            // JSON에서 ICE Candidate 생성
            String candidate = candidateData.get("candidate").asText();
            String sdpMid = candidateData.get("sdpMid").asText();
            int sdpMLineIndex = candidateData.get("sdpMLineIndex").asInt();

            IceCandidate iceCandidate = new IceCandidate(candidate, sdpMid, sdpMLineIndex);
            endpoint.addIceCandidate(iceCandidate);

            log.debug("ICE Candidate 추가 완료: sessionId={}", sessionId);

        } catch (Exception e) {
            log.error("ICE Candidate 추가 실패: sessionId={}", sessionId, e);
            // ICE Candidate 실패는 연결을 중단시키지 않음
        }
    }

    /**
     * 통화 종료
     */
    public void stopCommunication(String sessionId) {
        try {
            log.info("통화 종료: sessionId={}", sessionId);

            WebRtcEndpoint endpoint = userEndpoints.get(sessionId);
            if (endpoint != null) {
                endpoint.release();
                userEndpoints.remove(sessionId);
            }

            log.info("통화 종료 완료: sessionId={}", sessionId);

        } catch (Exception e) {
            log.error("통화 종료 실패: sessionId={}", sessionId, e);
            throw new RuntimeException("통화 종료 실패", e);
        }
    }

    /**
     * 방 나가기
     */
    public void leaveRoom(String sessionId) {
        try {
            String roomId = sessionRooms.remove(sessionId);
            if (roomId == null) {
                log.warn("방 정보를 찾을 수 없음: sessionId={}", sessionId);
                return;
            }

            log.info("방 나가기: sessionId={}, roomId={}", sessionId, roomId);

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
                    log.info("빈 방 정리 완료: roomId={}", roomId);
                }
            }

            log.info("방 나가기 완료: sessionId={}", sessionId);

        } catch (Exception e) {
            log.error("방 나가기 실패: sessionId={}", sessionId, e);
        }
    }

    // === 내부 헬퍼 메서드들 ===

    /**
     * 방의 미디어 파이프라인 생성 또는 가져오기
     */
    private MediaPipeline getOrCreatePipeline(String roomId) {
        return roomPipelines.computeIfAbsent(roomId, k -> {
            log.info("새 미디어 파이프라인 생성: roomId={}", roomId);
            return kurentoClient.createMediaPipeline();
        });
    }

    /**
     * 기존 참가자들과 연결
     */
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

    /**
     * ICE Candidate를 클라이언트에게 전송
     */
    private void sendIceCandidateToClient(String sessionId, IceCandidate candidate) {
        try {
            // ICE Candidate를 JSON으로 변환
            ObjectMapper mapper = new ObjectMapper();
            JsonNode candidateJson = mapper.createObjectNode()
                    .put("candidate", candidate.getCandidate())
                    .put("sdpMid", candidate.getSdpMid())
                    .put("sdpMLineIndex", candidate.getSdpMLineIndex());

            // SignalingHandler를 통해 클라이언트에게 전송
            signalingHandler.sendIceCandidate(sessionId, candidateJson);

        } catch (Exception e) {
            log.error("ICE Candidate 전송 중 오류: sessionId={}", sessionId, e);
        }
    }

    /**
     * 서비스 상태 정보 반환
     */
    public Map<String, Object> getServiceStatus() {
        Map<String, Object> status = new ConcurrentHashMap<>();
        status.put("connectedEndpoints", userEndpoints.size());
        status.put("activePipelines", roomPipelines.size());
        status.put("activeRooms", roomParticipants.size());
        status.put("kurentoClientConnected", kurentoClient != null);
        return status;
    }
}