"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Avatar from "@/components/Avatar";
import type { Me, PublicUser } from "@/lib/types";
import { api } from "./api";
import { formatDuration } from "./format";
import { playReceivedSound, startRingtone, stopRingtone } from "./sound";

export type ActiveCall = {
  callId: string;
  peer: PublicUser;
  type: "audio" | "video";
  direction: "incoming" | "outgoing";
  state: "ringing" | "connecting" | "connected" | "ended";
};

export type SignalPayload = {
  fromUserId: string;
  fromUser: PublicUser;
  callId: string;
  callType: "audio" | "video";
  type: "offer" | "answer" | "ice" | "ring" | "reject" | "hangup" | "busy";
  payload?: any;
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

export default function WebRTCManager({
  me,
  call,
  onEndCall,
  onSignalReceived,
}: {
  me: Me;
  call: ActiveCall | null;
  onEndCall: () => void;
  onSignalReceived?: (sig: SignalPayload) => void;
}) {
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [duration, setDuration] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  const sendSignal = useCallback(
    async (type: SignalPayload["type"], payload?: any) => {
      if (!call) return;
      try {
        await api("/api/calls/signal", {
          method: "POST",
          body: {
            toUserId: call.peer.id,
            callId: call.callId,
            callType: call.type,
            type,
            payload,
          },
        });
      } catch {
        /* ignore */
      }
    },
    [call],
  );

  const cleanup = useCallback(() => {
    stopRingtone();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    remoteStreamRef.current = null;
    setDuration(0);
    startTimeRef.current = null;
  }, []);

  const endCall = useCallback(
    async (status: "completed" | "missed" | "declined" | "cancelled" = "completed") => {
      const dur = startTimeRef.current ? Math.round((Date.now() - startTimeRef.current) / 1000) : 0;
      await sendSignal("hangup");
      if (call) {
        void api("/api/calls", {
          method: "PATCH",
          body: {
            callId: call.callId,
            status,
            durationSec: dur,
          },
        }).catch(() => {});
      }
      cleanup();
      onEndCall();
    },
    [call, cleanup, onEndCall, sendSignal],
  );

  const startLocalMedia = useCallback(async (withVideo: boolean) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: withVideo ? { facingMode: "user" } : false,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (e) {
      console.warn("[webrtc] media error", e);
      try {
        // Fallback to audio only
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = audioOnly;
        return audioOnly;
      } catch {
        return null;
      }
    }
  }, []);

  // Answer call
  const answerCall = useCallback(async () => {
    if (!call) return;
    stopRingtone();
    const stream = await startLocalMedia(call.type === "video");
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        remoteStreamRef.current = event.streams[0];
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void sendSignal("ice", event.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        startTimeRef.current = Date.now();
        timerRef.current = window.setInterval(() => {
          if (startTimeRef.current) {
            setDuration(Math.round((Date.now() - startTimeRef.current) / 1000));
          }
        }, 1000);
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        void endCall("completed");
      }
    };

    await sendSignal("ring");
  }, [call, endCall, sendSignal, startLocalMedia]);

  // Outgoing call start
  useEffect(() => {
    if (!call) return;
    if (call.direction === "outgoing") {
      let isCancelled = false;
      const initCaller = async () => {
        const stream = await startLocalMedia(call.type === "video");
        if (isCancelled) return;
        const pc = new RTCPeerConnection(RTC_CONFIG);
        pcRef.current = pc;

        if (stream) {
          stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        }

        pc.ontrack = (event) => {
          if (event.streams && event.streams[0]) {
            remoteStreamRef.current = event.streams[0];
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = event.streams[0];
            }
          }
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            void sendSignal("ice", event.candidate);
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") {
            stopRingtone();
            startTimeRef.current = Date.now();
            timerRef.current = window.setInterval(() => {
              if (startTimeRef.current) {
                setDuration(Math.round((Date.now() - startTimeRef.current) / 1000));
              }
            }, 1000);
          } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            void endCall("completed");
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal("offer", offer);
      };

      void initCaller();
      return () => {
        isCancelled = true;
      };
    } else {
      // Incoming call: start ringtone
      startRingtone();
    }
  }, [call?.callId]);

  // Handle external signals relayed via props / SSE
  const handleSignal = useCallback(
    async (sig: SignalPayload) => {
      const pc = pcRef.current;
      if (sig.type === "offer") {
        if (!pcRef.current) {
          const stream = await startLocalMedia(call?.type === "video");
          const newPc = new RTCPeerConnection(RTC_CONFIG);
          pcRef.current = newPc;
          if (stream) {
            stream.getTracks().forEach((track) => newPc.addTrack(track, stream));
          }
          newPc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
              remoteStreamRef.current = event.streams[0];
              if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = event.streams[0];
              }
            }
          };
          newPc.onicecandidate = (event) => {
            if (event.candidate) void sendSignal("ice", event.candidate);
          };
          await newPc.setRemoteDescription(new RTCSessionDescription(sig.payload));
          const answer = await newPc.createAnswer();
          await newPc.setLocalDescription(answer);
          await sendSignal("answer", answer);
        }
      } else if (sig.type === "answer" && pc) {
        stopRingtone();
        await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));
      } else if (sig.type === "ice" && pc && sig.payload) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(sig.payload));
        } catch {
          /* ignore */
        }
      } else if (sig.type === "hangup" || sig.type === "reject") {
        stopRingtone();
        cleanup();
        onEndCall();
      }
    },
    [call?.type, cleanup, onEndCall, sendSignal, startLocalMedia],
  );

  useEffect(() => {
    (window as any).__fidHandleCallSignal = handleSignal;
    return () => {
      delete (window as any).__fidHandleCallSignal;
    };
  }, [handleSignal]);

  const toggleMic = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
      setMicMuted((m) => !m);
    }
  };

  const toggleCam = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
      setCamOff((c) => !c);
    }
  };

  const switchCamera = async () => {
    const nextMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextMode);
    if (localStreamRef.current && pcRef.current) {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: nextMode },
        });
        const newTrack = newStream.getVideoTracks()[0];
        const oldTrack = localStreamRef.current.getVideoTracks()[0];
        if (oldTrack && newTrack) {
          const sender = pcRef.current.getSenders().find((s) => s.track === oldTrack);
          if (sender) await sender.replaceTrack(newTrack);
          oldTrack.stop();
          localStreamRef.current.removeTrack(oldTrack);
          localStreamRef.current.addTrack(newTrack);
          if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
        }
      } catch {
        /* ignore */
      }
    }
  };

  if (!call) return null;

  // Incoming Call Ringing Modal
  if (call.direction === "incoming" && !startTimeRef.current) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" dir="rtl">
        <div className="flex w-full max-w-sm flex-col items-center rounded-3xl bg-slate-900 p-6 text-center text-white shadow-2xl ring-1 ring-white/10">
          <div className="relative mb-4">
            <Avatar id={call.peer.id} name={call.peer.displayName} url={call.peer.avatarUrl} size={90} />
            <span className="absolute -bottom-1 -left-1 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-lg shadow">
              {call.type === "video" ? "📹" : "📞"}
            </span>
          </div>
          <h3 className="text-xl font-extrabold">{call.peer.displayName}</h3>
          <p className="mt-1 text-xs text-emerald-400 font-mono" dir="ltr">
            {call.peer.publicId} · @{call.peer.username}
          </p>
          <p className="mt-3 text-sm text-slate-300 animate-pulse">
            {call.type === "video" ? "مكالمة فيديو واردة…" : "مكالمة صوتية واردة…"}
          </p>
          <div className="mt-8 flex w-full items-center justify-around gap-4">
            <button
              type="button"
              onClick={() => void endCall("declined")}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-2xl text-white shadow-lg transition hover:scale-105 active:scale-95"
              title="رفض"
            >
              ✕
            </button>
            <button
              type="button"
              onClick={() => void answerCall()}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-2xl text-white shadow-lg animate-bounce hover:scale-105 active:scale-95"
              title="قبول"
            >
              {call.type === "video" ? "📹" : "📞"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active Call Screen (Floating / Fullscreen)
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white" dir="rtl">
      {/* Remote Video / Audio View */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-slate-900">
        {call.type === "video" ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center">
            <div className="relative">
              <Avatar id={call.peer.id} name={call.peer.displayName} url={call.peer.avatarUrl} size={110} />
              {startTimeRef.current && (
                <div className="absolute -inset-2 animate-ping rounded-full border-2 border-emerald-500 opacity-30" />
              )}
            </div>
            <h2 className="mt-4 text-2xl font-extrabold">{call.peer.displayName}</h2>
            <div className="mt-1 font-mono text-sm text-emerald-400">
              {startTimeRef.current ? formatDuration(duration) : "جارٍ الاتصال…"}
            </div>
          </div>
        )}

        {/* Local Video Thumbnail (PiP) */}
        {call.type === "video" && (
          <div className="absolute top-4 left-4 h-36 w-28 overflow-hidden rounded-2xl bg-black/60 shadow-xl ring-2 ring-white/20 md:h-48 md:w-36">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover ${facingMode === "user" ? "-scale-x-100" : ""}`}
            />
            {camOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-xs text-slate-400">
                الكاميرا متوقفة
              </div>
            )}
          </div>
        )}

        {/* Call Timer Overlay */}
        {call.type === "video" && (
          <div className="absolute top-4 right-4 flex items-center gap-2 rounded-full bg-black/50 px-4 py-1.5 text-xs font-mono backdrop-blur">
            <span>{call.peer.displayName}</span>
            <span>•</span>
            <span className="text-emerald-400 font-bold">{startTimeRef.current ? formatDuration(duration) : "جارٍ الاتصال…"}</span>
          </div>
        )}
      </div>

      {/* Control Bar */}
      <div className="flex items-center justify-center gap-5 bg-slate-900/90 px-6 py-5 backdrop-blur-md">
        <button
          type="button"
          onClick={toggleMic}
          className={`flex h-13 w-13 items-center justify-center rounded-full text-xl transition ${micMuted ? "bg-red-600 text-white" : "bg-white/15 text-white hover:bg-white/25"}`}
          title={micMuted ? "تشغيل الميكروفون" : "كتم الميكروفون"}
        >
          {micMuted ? "🔇" : "🎤"}
        </button>

        {call.type === "video" && (
          <>
            <button
              type="button"
              onClick={toggleCam}
              className={`flex h-13 w-13 items-center justify-center rounded-full text-xl transition ${camOff ? "bg-red-600 text-white" : "bg-white/15 text-white hover:bg-white/25"}`}
              title={camOff ? "تشغيل الكاميرا" : "إيقاف الكاميرا"}
            >
              {camOff ? "🚫" : "📹"}
            </button>
            <button
              type="button"
              onClick={() => void switchCamera()}
              className="flex h-13 w-13 items-center justify-center rounded-full bg-white/15 text-xl text-white transition hover:bg-white/25"
              title="تبديل الكاميرا"
            >
              🔄
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => void endCall("completed")}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-2xl text-white shadow-xl transition hover:bg-red-700 active:scale-95"
          title="إنهاء المكالمة"
        >
          📞
        </button>
      </div>
    </div>
  );
}
