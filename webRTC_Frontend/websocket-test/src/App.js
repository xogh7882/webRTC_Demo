import { useState, useEffect, useRef } from 'react';
import './App.css';

export default function VideoChat() {
  const [ws, setWs] = useState(null);
  const [connected, setConnected] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [roomId, setRoomId] = useState('room1');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [connectionState, setConnectionState] = useState('disconnected');
  const [error, setError] = useState(null);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const wsRef = useRef(null);

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // 현재 시간 업데이트
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  // 시간 포맷팅
  const formatTime = (date) => {
    return date.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // 날짜 포맷팅
  const formatDate = (date) => {
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // 전체 정리 함수
  const cleanup = () => {
    console.log('🧹 전체 정리 시작');
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('로컬 트랙 중지:', track.kind);
      });
      localStreamRef.current = null;
    }
    
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
      console.log('PeerConnection 종료');
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      console.log('WebSocket 연결 종료');
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
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }, 
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      
      console.log('✅ 미디어 스트림 획득 성공');
      console.log('📊 트랙 정보:', stream.getTracks().map(track => ({
        kind: track.kind,
        enabled: track.enabled,
        readyState: track.readyState
      })));
      
      localStreamRef.current = stream;
      
      if (localVideoRef.current) {
        const videoElement = localVideoRef.current;
        videoElement.srcObject = stream;
        
        // 안전한 재생 시도
        try {
          await videoElement.play();
          console.log('🎬 로컬 비디오 재생 시작');
        } catch (playError) {
          console.warn('⚠️ 로컬 비디오 자동 재생 실패:', playError.message);
          // 사용자 상호작용 후 재생하도록 설정
          videoElement.muted = true;
          await videoElement.play();
        }
      }
      
      return stream;
    } catch (error) {
      console.warn('⚠️ 미디어 접근 실패, 오디오만 시도:', error.message);
      
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = audioStream;
        console.log('🎤 오디오만 스트림 획득');
        return audioStream;
      } catch (audioError) {
        console.warn('⚠️ 오디오도 실패, 수신 전용 모드:', audioError.message);
        return null;
      }
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
          console.log('📩 메시지 수신:', message.type);
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
        console.log('🏠 방 참가 완료:', message.roomId);
        setConnectionState('joined');
        break;
        
      case 'user-joined':
        console.log('👤 새 사용자 참가:', message.sessionId);
        await createOffer();
        break;
        
      case 'offer':
        console.log('📨 Offer 수신');
        await handleOffer(message.data);
        break;
        
      case 'answer':
        console.log('📨 Answer 수신');
        await handleAnswer(message.data);
        break;
        
      case 'ice-candidate':
        console.log('🧊 ICE Candidate 수신');
        await handleIceCandidate(message.data);
        break;
        
      case 'user-left':
        console.log('👋 사용자 나감:', message.sessionId);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
        setInCall(false);
        setConnectionState('connected');
        break;
        
      case 'error':
        console.error('🚨 서버 에러:', message.message);
        handleError('서버 에러: ' + message.message);
        break;
        
      default:
        console.warn('🤷 알 수 없는 메시지:', message.type);
    }
  };

  // PeerConnection 생성
  const createPeerConnection = () => {
    console.log('🔗 PeerConnection 생성');
    const pc = new RTCPeerConnection(iceServers);
    
    // ICE Candidate 이벤트
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        console.log('🧊 ICE Candidate 전송');
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          data: event.candidate
        }));
      } else if (!event.candidate) {
        console.log('🧊 ICE Gathering 완료');
      }
    };
    
    // 원격 스트림 수신
    pc.ontrack = (event) => {
      console.log('🎉 원격 스트림 수신!');
      const [remoteStream] = event.streams;
      
      console.log('📊 원격 스트림 정보:', {
        id: remoteStream.id,
        tracks: remoteStream.getTracks().map(track => ({
          kind: track.kind,
          enabled: track.enabled,
          readyState: track.readyState
        }))
      });
      
      if (remoteVideoRef.current) {
        const videoElement = remoteVideoRef.current;
        
        // 기존 재생을 안전하게 중지
        videoElement.pause();
        videoElement.srcObject = null;
        
        // 새 스트림 설정
        videoElement.srcObject = remoteStream;
        
        // 짧은 지연 후 재생 시도
        setTimeout(() => {
          videoElement.play().then(() => {
            console.log('🎬 원격 비디오 재생 시작');
            setInCall(true);
            setConnectionState('in-call');
          }).catch(err => {
            console.error('❌ 원격 비디오 재생 실패:', err);
            // 재생 실패해도 연결은 성공한 것으로 처리
            setInCall(true);
            setConnectionState('in-call');
          });
        }, 100);
      }
    };

    // 연결 상태 모니터링
    pc.oniceconnectionstatechange = () => {
      console.log('🧊 ICE 연결 상태:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        console.error('❌ ICE 연결 실패');
        handleError('ICE 연결 실패');
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('🔗 연결 상태:', pc.connectionState);
      if (pc.connectionState === 'failed') {
        console.error('❌ PeerConnection 실패');
        handleError('PeerConnection 실패');
      }
    };
    
    // 로컬 스트림 트랙 추가
    if (localStreamRef.current) {
      console.log('📤 로컬 트랙 추가');
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
        console.log('➕ 트랙 추가됨:', track.kind);
      });
    } else {
      console.log('⚠️ 로컬 스트림 없음 (수신 전용 모드)');
    }
    
    return pc;
  };

  // Offer 생성
  const createOffer = async () => {
    try {
      console.log('📤 Offer 생성 시작');
      pcRef.current = createPeerConnection();
      
      const offer = await pcRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await pcRef.current.setLocalDescription(offer);
      console.log('✅ Local Description 설정 완료');
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'offer',
          data: offer
        }));
        console.log('📤 Offer 전송 완료');
      } else {
        throw new Error('WebSocket 연결 없음');
      }
    } catch (error) {
      console.error('❌ Offer 생성 실패:', error);
      handleError('Offer 생성 실패', error);
    }
  };

  // Offer 처리
  const handleOffer = async (offer) => {
    try {
      console.log('📥 Offer 처리 시작');
      pcRef.current = createPeerConnection();
      
      await pcRef.current.setRemoteDescription(offer);
      console.log('✅ Remote Description 설정 완료');
      
      const answer = await pcRef.current.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await pcRef.current.setLocalDescription(answer);
      console.log('✅ Answer 생성 완료');
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'answer',
          data: answer
        }));
        console.log('📤 Answer 전송 완료');
      } else {
        throw new Error('WebSocket 연결 없음');
      }
    } catch (error) {
      console.error('❌ Offer 처리 실패:', error);
      handleError('Offer 처리 실패', error);
    }
  };

  // Answer 처리
  const handleAnswer = async (answer) => {
    try {
      console.log('📥 Answer 처리 시작');
      if (!pcRef.current) {
        throw new Error('PeerConnection 없음');
      }
      
      await pcRef.current.setRemoteDescription(answer);
      console.log('✅ Answer 처리 완료');
    } catch (error) {
      console.error('❌ Answer 처리 실패:', error);
      handleError('Answer 처리 실패', error);
    }
  };

  // ICE Candidate 처리
  const handleIceCandidate = async (candidate) => {
    try {
      if (!pcRef.current) {
        console.warn('⚠️ PeerConnection 없음, ICE Candidate 무시');
        return;
      }
      
      await pcRef.current.addIceCandidate(candidate);
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
      handleError('연결 실패: ' + error.message, error);
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
                    <span className="connecting-text">화상 상담 대기 중</span>
                    <span className="security-text">보안 연결로 보호됨</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 컨트롤 버튼들 */}
          <div className="control-buttons">
            <button className="control-btn mute-btn" onClick={toggleMute} disabled={!localStreamRef.current}>
              🎤
            </button>
            <button className="control-btn video-btn" onClick={toggleVideo} disabled={!localStreamRef.current}>
              📹
            </button>
            <button className="control-btn end-call-btn" onClick={disconnect} disabled={!connected}>
              📞
            </button>
          </div>

          {/* 연결 상태 및 방 ID 입력 */}
          <div className="connection-section">
            <div className="room-input">
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="방 ID"
                disabled={connected}
                className="room-id-input"
              />
            </div>
            
            <div className="connection-button">
              {!connected ? (
                <button
                  onClick={connect}
                  className="action-btn start-consultation active"
                  disabled={connectionState === 'connecting'}
                >
                  {connectionState === 'connecting' ? '연결 중...' : '연결'}
                </button>
              ) : (
                <button
                  onClick={disconnect}
                  className="action-btn start-consultation active"
                >
                  종료
                </button>
              )}
            </div>
            
            <div className="connection-status-indicator">
              <span className={`status-badge ${getStatusClass()}`}>
                {getStatusText()}
              </span>
            </div>
          </div>

          {/* 액션 버튼들 */}
          <div className="action-buttons">
            <button className="action-btn create-link">초대 링크 생성</button>
            <button className="action-btn consultation-settings">화상상담 설정</button>
          </div>
        </div>

        {/* 오른쪽 사이드바 */}
        <div className="sidebar">
          {/* 시간 표시 */}
          <div className="time-display">
            <div className="current-time">
              오후 {formatTime(currentTime)}
            </div>
            <div className="current-date">
              {formatDate(currentTime)}
            </div>
          </div>

          {/* 캘린더 */}
          <div className="calendar">
            <div className="calendar-header">2025년 7월</div>
            <div className="calendar-grid">
              <div className="calendar-day-header">일</div>
              <div className="calendar-day-header">월</div>
              <div className="calendar-day-header">화</div>
              <div className="calendar-day-header">수</div>
              <div className="calendar-day-header">목</div>
              <div className="calendar-day-header">금</div>
              <div className="calendar-day-header">토</div>
              
              {/* 7월 달력 날짜들 */}
              {Array.from({length: 31}, (_, i) => (
                <div key={i + 1} className={`calendar-day ${i + 1 === 25 ? 'today' : ''}`}>
                  {i + 1}
                </div>
              ))}
            </div>
            <div className="calendar-note">상담 일정이 있는 날짜를 클릭하세요</div>
          </div>

          {/* 오늘의 상담 일정 */}
          <div className="consultation-schedule">
            <h3>오늘의 상담 일정</h3>
            <div className="no-schedule">오늘 예정인 상담이 없습니다</div>
          </div>
        </div>
      </div>
    </div>
  );
}