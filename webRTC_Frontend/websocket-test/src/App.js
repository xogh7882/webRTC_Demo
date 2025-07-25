import { useState, useEffect, useRef } from 'react';
import './App.css';

export default function VideoChat() {
  const [ws, setWs] = useState(null);
  const [connected, setConnected] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [roomId, setRoomId] = useState('room1');
  const [currentTime, setCurrentTime] = useState(new Date());
  
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

  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (pcRef.current) {
        pcRef.current.close();
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const connect = async () => {
    try {
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        console.log('미디어 접근 성공');
      } catch (mediaError) {
        console.log('미디어 접근 실패, 테스트 모드로 진행:', mediaError.message);
      }
      
      if (stream) {
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      }

      const websocket = new WebSocket('ws://localhost:8080/signaling');
      
      websocket.onopen = () => {
        console.log('웹소켓 연결됨');
        setConnected(true);
        setWs(websocket);
        wsRef.current = websocket;
        
        websocket.send(JSON.stringify({
          type: 'join',
          roomId: roomId
        }));
      };
      
      websocket.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('수신:', message.type);
        
        switch (message.type) {
          case 'joined':
            console.log('방 참가됨:', message.roomId);
            break;
            
          case 'user-joined':
            console.log('사용자 참가:', message.sessionId);
            await createOffer();
            break;
            
          case 'offer':
            await handleOffer(message.data);
            break;
            
          case 'answer':
            await handleAnswer(message.data);
            break;
            
          case 'ice-candidate':
            await handleIceCandidate(message.data);
            break;
            
          case 'user-left':
            console.log('사용자 나감:', message.sessionId);
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = null;
            }
            setInCall(false);
            break;
        }
      };
      
      websocket.onclose = () => {
        console.log('웹소켓 연결 종료');
        setConnected(false);
        setInCall(false);
      };
      
      setWs(websocket);
      
    } catch (error) {
      console.error('연결 에러:', error);
      alert('연결에 실패했습니다: ' + error.message);
    }
  };

  const createPeerConnection = () => {
    console.log('PeerConnection 생성 시작');
    const pc = new RTCPeerConnection(iceServers);
    
    pc.onicecandidate = (event) => {
      console.log('ICE candidate 생성:', event.candidate ? 'candidate' : 'null');
      if (event.candidate && wsRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          data: event.candidate
        }));
      }
    };
    
    pc.ontrack = (event) => {
      console.log('원격 스트림 수신!!! 성공!!!');
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
      setInCall(true);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE 연결 상태:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('연결 상태:', pc.connectionState);
    };
    
    if (localStreamRef.current) {
      console.log('로컬 스트림 트랙 추가:', localStreamRef.current.getTracks().length);
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    } else {
      console.log('로컬 스트림 없음, 테스트 모드');
    }
    
    return pc;
  };

  const createOffer = async () => {
    try {
      console.log('=== Offer 생성 시작 ===');
      pcRef.current = createPeerConnection();
      const offer = await pcRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await pcRef.current.setLocalDescription(offer);
      console.log('Offer 생성 완료, 전송');
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log('WebSocket 상태: 연결됨');
        console.log('Offer 전송 시도');
        wsRef.current.send(JSON.stringify({
          type: 'offer',
          data: offer
        }));
        console.log('Offer 전송 완료');
      } else {
        console.error('WebSocket 연결되지 않음! 상태:', wsRef.current?.readyState);
      }
    } catch (error) {
      console.error('Offer 생성 에러:', error);
    }
  };

  const handleOffer = async (offer) => {
    try {
      console.log('=== Offer 수신 처리 시작 ===');
      pcRef.current = createPeerConnection();
      await pcRef.current.setRemoteDescription(offer);
      
      const answer = await pcRef.current.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await pcRef.current.setLocalDescription(answer);
      console.log('Answer 생성 완료, 전송');
      
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'answer',
          data: answer
        }));
      }
    } catch (error) {
      console.error('Offer 처리 에러:', error);
    }
  };

  const handleAnswer = async (answer) => {
    try {
      console.log('=== Answer 수신 처리 ===');
      await pcRef.current.setRemoteDescription(answer);
      console.log('Answer 설정 완료');
    } catch (error) {
      console.error('Answer 처리 에러:', error);
    }
  };

  const handleIceCandidate = async (candidate) => {
    try {
      console.log('=== ICE Candidate 수신 ===');
      await pcRef.current.addIceCandidate(candidate);
    } catch (error) {
      console.error('ICE candidate 처리 에러:', error);
    }
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'leave' }));
      wsRef.current.close();
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (pcRef.current) {
      pcRef.current.close();
    }
    
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    
    setConnected(false);
    setInCall(false);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
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
                    <span className="connecting-text">화상 상담 진행 중</span>
                    <span className="security-text">보호되어 업로되었습니다</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 컨트롤 버튼들 */}
          <div className="control-buttons">
            <button className="control-btn mute-btn" onClick={toggleMute}>
              🎤
            </button>
            <button className="control-btn video-btn" onClick={toggleVideo}>
              📹
            </button>
            <button className="control-btn end-call-btn" onClick={disconnect}>
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
                >
                  연결
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
              <span className={`status-badge ${connected ? (inCall ? 'in-call' : 'connected') : 'disconnected'}`}>
                {connected ? (inCall ? '통화 중' : '연결됨') : '연결 안됨'}
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
                <div key={i + 1} className={`calendar-day ${i + 1 === 18 ? 'today' : ''}`}>
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