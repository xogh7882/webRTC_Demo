// App.js - Kurento SDP 교환 로직 추가

import React, { useState, useRef, useEffect } from 'react';
import './App.css';

function App() {
  // 상태 관리
  const [connected, setConnected] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [connectionState, setConnectionState] = useState('disconnected');
  const [error, setError] = useState(null);
  const [roomId, setRoomId] = useState('room123');
  const [ws, setWs] = useState(null);

  // Refs
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const wsRef = useRef(null);
  const pcRef = useRef(null);

  // cleanup
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  // 정리 함수
  const cleanup = () => {
    console.log('🧹 리소스 정리 시작');
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('🔇 트랙 정지:', track.kind);
      });
      localStreamRef.current = null;
    }
    
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
      console.log('📡 PeerConnection 종료');
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      console.log('🔌 WebSocket 연결 종료');
    }
    
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    
    setConnected(false);
    setInCall(false);
    setConnectionState('disconnected');
    setError(null);
  };

  // 에러 처리
  const handleError = (message, error) => {
    console.error(message, error);
    setError(message);
    setConnectionState('error');
  };

  // 미디어 스트림 가져오기
  const getMediaStream = async () => {
    try {
      console.log('📹 미디어 스트림 요청');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      
      console.log('✅ 미디어 스트림 획득 성공');
      localStreamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        console.log('🎬 로컬 비디오 설정 완료');
      }
      
      return stream;
    } catch (error) {
      console.error('❌ 미디어 스트림 획득 실패:', error);
      throw error;
    }
  };

  // WebSocket 연결
  const connectWebSocket = () => {
    return new Promise((resolve, reject) => {
      console.log('🔌 WebSocket 연결 시도');
      const websocket = new WebSocket('ws://70.12.247.69:8080/signaling');
      
      const timeout = setTimeout(() => {
        websocket.close();
        reject(new Error('WebSocket 연결 시간 초과'));
      }, 10000);
      
      websocket.onopen = () => {
        clearTimeout(timeout);
        console.log('✅ WebSocket 연결 성공');
        setConnected(true);
        setConnectionState('connected');
        setWs(websocket);
        wsRef.current = websocket;
        resolve(websocket);
      };
      
      websocket.onerror = (error) => {
        clearTimeout(timeout);
        console.error('❌ WebSocket 연결 에러:', error);
        reject(error);
      };
      
      websocket.onclose = (event) => {
        console.log('🔌 WebSocket 연결 종료:', event.code, event.reason);
        setConnected(false);
        setInCall(false);
        setConnectionState('disconnected');
      };
      
      websocket.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('📩 메시지 수신:', message.type, message);
          await handleWebSocketMessage(message);
        } catch (error) {
          console.error('❌ 메시지 처리 에러:', error);
        }
      };
    });
  };

  // WebSocket 메시지 처리
  const handleWebSocketMessage = async (message) => {
    switch (message.type) {
      case 'joined':
        console.log('🏠 방 참가 성공');
        setConnectionState('joined');
        // 방 참가 후 통화 시작 요청
        setTimeout(() => {
          startCall();
        }, 500);
        break;
        
      case 'startCommunication':
        console.log('📞 통화 시작 - SDP Offer 수신');
        await handleOffer(message.sdpOffer);
        break;
        
      case 'processAnswer':
        console.log('📞 SDP Answer 수신');
        await handleAnswer(message.sdpAnswer);
        break;
        
      case 'iceCandidate':
        console.log('🧊 ICE Candidate 수신');
        await handleIceCandidate(message.candidate);
        break;
        
      case 'error':
        console.error('❌ 서버 에러:', message.message);
        handleError('서버 에러: ' + message.message);
        break;
        
      default:
        console.warn('⚠️ 알 수 없는 메시지 타입:', message.type);
    }
  };

  // PeerConnection 생성
  const createPeerConnection = () => {
    console.log('📡 PeerConnection 생성');
    
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
    
    const pc = new RTCPeerConnection(configuration);

    // ICE Candidate 이벤트
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        console.log('🧊 ICE Candidate 전송');
        wsRef.current.send(JSON.stringify({
          type: 'onIceCandidate',
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex
          }
        }));
      }
    };

    // 원격 스트림 수신
    pc.ontrack = (event) => {
      console.log('📺 원격 스트림 수신');
      const [remoteStream] = event.streams;
      
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        console.log('🎬 원격 비디오 설정 완료');
        setInCall(true);
        setConnectionState('in-call');
      }
    };

    // 연결 상태 모니터링
    pc.oniceconnectionstatechange = () => {
      console.log('🧊 ICE 연결 상태:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('🔗 연결 상태:', pc.connectionState);
    };

    pcRef.current = pc;
    return pc;
  };

  // 통화 시작 (call 메시지 전송)
  const startCall = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('📞 통화 시작 요청');
      wsRef.current.send(JSON.stringify({
        type: 'call'
      }));
    }
  };

  // Offer 처리 (Kurento에서 받은 SDP Offer)
  const handleOffer = async (sdpOffer) => {
    try {
      console.log('📥 SDP Offer 처리 시작');
      
      // PeerConnection 생성
      const pc = createPeerConnection();
      
      // 로컬 스트림을 PeerConnection에 추가
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current);
          console.log('🎵 트랙 추가:', track.kind);
        });
      }
      
      // Remote Description 설정
      await pc.setRemoteDescription({
        type: 'offer',
        sdp: sdpOffer
      });
      console.log('✅ Remote Description 설정 완료');
      
      // Answer 생성
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('✅ Answer 생성 완료');
      
      // Answer를 서버로 전송
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'processAnswer',
          sdpAnswer: answer.sdp
        }));
        console.log('📤 Answer 전송 완료');
      }
      
    } catch (error) {
      console.error('❌ Offer 처리 실패:', error);
      handleError('Offer 처리 실패: ' + error.message);
    }
  };

  // Answer 처리 (상대방이 보낸 Answer)
  const handleAnswer = async (sdpAnswer) => {
    try {
      console.log('📥 SDP Answer 처리 시작');
      
      if (!pcRef.current) {
        // 내가 Offer를 보낸 경우의 PeerConnection 생성
        const pc = createPeerConnection();
        
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => {
            pc.addTrack(track, localStreamRef.current);
          });
        }
      }
      
      await pcRef.current.setRemoteDescription({
        type: 'answer',
        sdp: sdpAnswer
      });
      console.log('✅ Answer 처리 완료');
      
    } catch (error) {
      console.error('❌ Answer 처리 실패:', error);
      handleError('Answer 처리 실패: ' + error.message);
    }
  };

  // ICE Candidate 처리
  const handleIceCandidate = async (candidate) => {
    try {
      if (!pcRef.current) {
        console.warn('⚠️ PeerConnection 없음, ICE Candidate 무시');
        return;
      }
      
      await pcRef.current.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex
      });
      console.log('✅ ICE Candidate 추가 완료');
    } catch (error) {
      console.error('❌ ICE Candidate 처리 실패:', error);
    }
  };

  // 연결 시작
  const connect = async () => {
    try {
      setError(null);
      setConnectionState('connecting');
      console.log('🚀 연결 프로세스 시작');
      
      // 1. 미디어 스트림 가져오기
      await getMediaStream();
      
      // 2. WebSocket 연결
      const websocket = await connectWebSocket();
      
      // 3. 방 참가
      console.log('🏠 방 참가 요청:', roomId);
      websocket.send(JSON.stringify({
        type: 'join',
        roomId: roomId
      }));
      
    } catch (error) {
      console.error('❌ 연결 실패:', error);
      handleError('연결 실패: ' + error.message);
      cleanup();
    }
  };

  // 연결 종료
  const disconnect = () => {
    console.log('🔌 연결 종료 요청');
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'leave' }));
    }
    
    cleanup();
  };

  // 음소거 토글
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
        console.log('🎤 음소거 토글:', track.enabled ? '해제' : '설정');
      });
    }
  };

  // 비디오 토글
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
        console.log('📹 비디오 토글:', track.enabled ? '활성화' : '비활성화');
      });
    }
  };

  // 연결 상태 표시 텍스트
  const getStatusText = () => {
    switch (connectionState) {
      case 'connecting': return '연결 중...';
      case 'connected': return '연결됨';
      case 'joined': return '방 참가됨';
      case 'in-call': return '통화 중';
      case 'error': return '연결 실패';
      default: return '연결 안됨';
    }
  };

  const getStatusClass = () => {
    switch (connectionState) {
      case 'connecting': return 'connecting';
      case 'connected':
      case 'joined': return 'connected';
      case 'in-call': return 'in-call';
      case 'error': return 'error';
      default: return 'disconnected';
    }
  };

  return (
    <div className="video-call-app">
      {/* 헤더 */}
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"></div>
        </div>
        <nav className="nav-menu">
          <span>Products</span>
          <span>Solutions</span>
          <span>Community</span>
          <span>Resources</span>
          <span>Pricing</span>
          <span>Contact</span>
          <span>Link</span>
        </nav>
        <div className="auth-buttons">
          <button className="sign-in">Sign in</button>
          <button className="register">Register</button>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <div className="main-content">
        {/* 왼쪽 화상통화 영역 */}
        <div className="video-section">
          <h1 className="section-title">화상 상담</h1>
          
          {/* 에러 메시지 */}
          {error && (
            <div className="error-message">
              ⚠️ {error}
            </div>
          )}
          
          {/* 비디오 컨테이너 */}
          <div className="video-container">
            <div className="video-grid">
              {/* 내 화면 */}
              <div className="video-item my-video">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="video-element"
                />
                <div className="video-label">내 화면</div>
              </div>
              
              {/* 상대방 화면 */}
              <div className="video-item remote-video">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="video-element"
                />
                <div className="video-label">상대방 화면</div>
                {!inCall && (
                  <div className="connection-status">
                    <span className="waiting-text">상대방을 기다리는 중...</span>
                    <span className="security-text">안전한 연결로 보호됩니다</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* 컨트롤 버튼 */}
          <div className="control-buttons">
            <button className="control-btn" onClick={toggleMute} disabled={!connected}>
              🎤
            </button>
            <button className="control-btn" onClick={toggleVideo} disabled={!connected}>
              📹
            </button>
            <button 
              className="control-btn end-call-btn" 
              onClick={disconnect}
              disabled={!connected}
            >
              📞
            </button>
          </div>
          
          {/* 연결 섹션 */}
          <div className="connection-section">
            <div className="room-input">
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="방 ID 입력"
                className="room-id-input"
                disabled={connected}
              />
            </div>
            
            <div className="connection-status-indicator">
              <span className={`status-badge ${getStatusClass()}`}>
                {getStatusText()}
              </span>
            </div>
            
            <div className="connection-button">
              {!connected ? (
                <button 
                  className="action-btn start-consultation"
                  onClick={connect}
                  disabled={connectionState === 'connecting'}
                >
                  {connectionState === 'connecting' ? '연결 중...' : '상담 시작'}
                </button>
              ) : (
                <button 
                  className="action-btn start-consultation"
                  onClick={disconnect}
                >
                  연결 종료
                </button>
              )}
            </div>
          </div>
          
          {/* 액션 버튼들 */}
          <div className="action-buttons">
            <button className="action-btn create-link">
              링크 생성
            </button>
            <button className="action-btn consultation-settings">
              상담 설정
            </button>
          </div>
        </div>

        {/* 오른쪽 사이드바 */}
        <div className="sidebar">
          {/* 시간 표시 */}
          <div className="time-display">
            <div className="current-time">14:30</div>
            <div className="current-date">2024년 1월 15일 월요일</div>
          </div>
          
          {/* 캘린더 */}
          <div className="calendar">
            <div className="calendar-header">1월 2024</div>
            <div className="calendar-grid">
              <div className="calendar-day-header">일</div>
              <div className="calendar-day-header">월</div>
              <div className="calendar-day-header">화</div>
              <div className="calendar-day-header">수</div>
              <div className="calendar-day-header">목</div>
              <div className="calendar-day-header">금</div>
              <div className="calendar-day-header">토</div>
              
              {Array.from({ length: 31 }, (_, i) => (
                <div 
                  key={i + 1} 
                  className={`calendar-day ${i === 14 ? 'today' : ''}`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
            <div className="calendar-note">오늘 일정이 없습니다</div>
          </div>
          
          {/* 상담 스케줄 */}
          <div className="consultation-schedule">
            <h3>상담 일정</h3>
            <div className="no-schedule">
              예정된 상담이 없습니다
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;