import { useState, useEffect, useRef } from 'react';

export default function VideoChat() {
  const [ws, setWs] = useState(null);
  const [connected, setConnected] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [roomId, setRoomId] = useState('room1');
  
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

      const websocket = new WebSocket('ws://192.168.1.103:8080/signaling');
      
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

  return (
    <div className="max-w-4xl mx-auto mt-8 p-6 bg-white rounded-lg shadow-lg">
      <h1 className="text-3xl font-bold mb-6 text-center">WebRTC 화상채팅</h1>
      
      <div className="mb-6 flex items-center justify-center space-x-4">
        <input
          type="text"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="방 ID"
          disabled={connected}
          className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
        
        {!connected ? (
          <button
            onClick={connect}
            className="px-6 py-2 bg-green-500 text-white rounded hover:bg-green-600"
          >
            연결
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="px-6 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            종료
          </button>
        )}
      </div>

      <div className="mb-4 text-center">
        <span className={`inline-block px-4 py-2 rounded-full text-sm font-medium ${
          connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {connected ? (inCall ? '통화 중' : '연결됨') : '연결 안됨'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">내 화면</h3>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-64 bg-black rounded-lg"
          />
        </div>
        
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">상대방 화면</h3>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-64 bg-black rounded-lg"
          />
        </div>
      </div>
    </div>
  );
}