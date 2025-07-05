'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Mic, Flag } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { auth, db } from "@/firebase/config";
import { doc, collection, getDocs, query, where, getDoc, addDoc, updateDoc, Timestamp } from "firebase/firestore";
import axios from "axios";
import path from "path";
import fs from 'fs';

import FormData from "form-data";

interface Appointment {
  id?: string;
  appointmentDate: string;
  appointmentTime: string;
  assignedDoctor: string;
  patientUsername: string;
  diagnosis?: string;
  medication?: string;
  scheduledDate?: Date | Timestamp | null;
}

interface AppointmentRequest {
  id?: string;
  patientId: string;
  patientUsername: string;
  symptoms: string;
  diagnosis: string;
  medication?: string;
  status: 'pending' | 'scheduled' | 'completed';
  createdAt: Date | Timestamp;
  scheduledDate?: Date | Timestamp | null;
  scheduledTime?: string;
  flaggedForReview?: boolean;
  resubmissionComment?: string;
}

const audioRecordingOptions = {
  audio: true,
  video: false
}

function toDateSafe(date: Date | Timestamp | null | undefined): Date | null {
  if (!date) return null;
  if (date instanceof Date) return date;
  if (typeof date === 'object' && 'toDate' in date && typeof date.toDate === 'function') return date.toDate();
  return null;
}

function PatientWelcomePage() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioData, setAudioData] = useState<Blob | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [medicalReport, setMedicalReport] = useState<{ transcript: string | null; diagnosis: string | null }>({
    transcript: null,
    diagnosis: null,
  });
  const [appointmentRequests, setAppointmentRequests] = useState<AppointmentRequest[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);

  // Initialize MediaRecorder
  useEffect(() => {
    const initRecorder = async () => {
      try {
        // Request microphone access
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
          video: false
        });

        setStream(audioStream);

        // Create MediaRecorder with default settings
        const recorder = new MediaRecorder(audioStream);
        
        // Create a variable to store the audio chunks
        let audioChunks: Blob[] = [];

        // Set up event handlers
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            // Store the chunk instead of setting audioData directly
            audioChunks.push(e.data);
          }
        };

        recorder.onstop = () => {
          setIsRecording(false);
          
          // Combine all chunks into a single Blob
          const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
          
          // Only set audioData once when recording is complete
          setAudioData(audioBlob);
          
          // Reset chunks for next recording
          audioChunks = [];
        };

        recorder.onerror = (event) => {
          console.error('MediaRecorder error:', event);
          toast({
            title: "Recording Error",
            description: "An error occurred during recording. Please try again.",
          });
        };

        setMediaRecorder(recorder);

      } catch (error) {
        console.error("Error initializing media recorder:", error);
        toast({
          title: "Error",
          description: "Failed to access microphone. Please check your permissions.",
        });
      }
    };

    initRecorder();

    // Cleanup
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startRecording = useCallback(() => {
    if (!mediaRecorder || !stream) {
      toast({
        title: "Error",
        description: "Recording device not ready. Please refresh the page.",
      });
      return;
    }

    try {
      // Stop any existing recording
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }

      // Clear previous audio data
      setAudioData(null);
      setIsRecording(true);

      // Start new recording without timeslice to only get data when stopped
      mediaRecorder.start();

    } catch (error) {
      console.error("Error starting recording:", error);
      toast({
        title: "Error",
        description: "Failed to start recording. Please try again.",
      });
      setIsRecording(false);
    }
  }, [mediaRecorder, stream]);

  const stopRecording = useCallback(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try {
        mediaRecorder.stop();
        setIsRecording(false);
        setIsDialogOpen(true);
      } catch (error) {
        console.error("Error stopping recording:", error);
        toast({
          title: "Error",
          description: "Failed to stop recording. Please try again.",
        });
      }
    }
  }, [mediaRecorder]);

  const handleMouseDown = () => {
    startRecording();
  };

  const handleMouseUp = () => {
    stopRecording();
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLButtonElement>) => {
    e.preventDefault();
    startRecording();
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLButtonElement>) => {
    e.preventDefault();
    stopRecording();
  };

  async function transcribeAudio(audioBlob: Blob): Promise<string> {
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.mp3');
      formData.append('model', 'whisper-1');

      const headers = {
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
        'Content-Type': 'multipart/form-data',
      };
      const transcribeResponse = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: headers,
      });
      return transcribeResponse.data.text;
    } catch (error: any) {
      console.error("Transcription error:", error.response ? error.response.data : error.message);
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }
  async function getDiagnosisFromTranscript(transcript: string): Promise<string> {
    try {
      const payload = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a medical assistant. Based on the transcript from a patient\'s spoken audio, provide a one-line medical diagnosis suitable for a doctor.',
          },
          {
            role: 'user',
            content: transcript,
          },
        ],
        temperature: 0.3,
      };

      const response = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
      });
      return response.data.choices[0].message.content.trim();
    } catch (error: any) {
      console.error("GPT-4o error:", error.response ? error.response.data : error.message);
      throw new Error(`Diagnosis failed: ${error.message}`);
    }
  }


  const handleContinue = async () => {
    if (!medicalReport.transcript || !medicalReport.diagnosis) {
      toast({
        title: "Error",
        description: "Please complete the voice recording and processing first.",
      });
      return;
    }

    try {
      const user = auth.currentUser;
      if (!user) {
        toast({
          title: "Error",
          description: "Please sign in to submit your request.",
        });
        return;
      }

      // Create appointment request with diagnosis
      const appointmentRequest: AppointmentRequest = {
        patientId: user.uid,
        patientUsername: user.displayName || 'Anonymous',
        symptoms: medicalReport.transcript,
        diagnosis: medicalReport.diagnosis,
        status: 'pending',
        createdAt: new Date(),
      };

      // Save to Firestore
      await addDoc(collection(db, 'appointmentRequests'), appointmentRequest);

      toast({
        title: "Success",
        description: "Your symptoms and diagnosis have been recorded. A doctor will review and schedule an appointment.",
      });

      // Reset states
      setMedicalReport({ transcript: null, diagnosis: null });
      setIsDialogOpen(false);
      setReportReady(false);

    } catch (error) {
      console.error("Error submitting appointment request:", error);
      toast({
        title: "Error",
        description: "Failed to submit request. Please try again.",
      });
    }
  };

  useEffect(() => {
    const processAudio = async () => {
      if (!audioData) return;
      
      setIsProcessing(true);  // Start loading
      try {
        // Show specific stage of processing
        toast({
          title: "Processing",
          description: "Transcribing your recording...",
        });
        
        const transcript = await transcribeAudio(audioData);
        
        // Update toast for diagnosis stage
        toast({
          title: "Processing",
          description: "Generating diagnosis...",
        });
        
        const diagnosis = await getDiagnosisFromTranscript(transcript);
        
        setMedicalReport({ transcript, diagnosis });
        setReportReady(true);
        
        // Success toast
        toast({
          title: "Complete",
          description: "Your recording has been processed successfully.",
        });
      } catch (error) {
        console.error("Processing error:", error);
        toast({
          title: "Error",
          description: "Failed to process your recording. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);  // End loading
      }
    };

    processAudio();
  }, [audioData]);

  // Fetch patient's appointment requests
  const fetchAppointmentRequests = async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const q = query(
        collection(db, 'appointmentRequests'),
        where('patientId', '==', user.uid)
      );
      const querySnapshot = await getDocs(q);
      const requests = querySnapshot.docs.map(doc => {
        const data = doc.data();
        // Convert Firestore timestamp to Date object
        return {
          ...data,
          id: doc.id,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt || new Date(),
          scheduledDate: data.scheduledDate?.toDate ? data.scheduledDate.toDate() : data.scheduledDate || null,
        };
      }) as AppointmentRequest[];
      setAppointmentRequests(requests);
    } catch (error) {
      console.error("Error fetching appointment requests:", error);
    }
  };

  useEffect(() => {
    fetchAppointmentRequests();
  }, []);

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Patient Dashboard</h1>
      
      {/* Voice Recording Section */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Record Your Symptoms</h2>
        <div className="flex items-center space-x-4">
          <Button
            variant={isRecording ? "destructive" : "default"}
            className="rounded-full p-4"
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            disabled={!mediaRecorder || isProcessing}
          >
            <Mic className="h-6 w-6" />
          </Button>
          <div className="flex items-center space-x-2">
            <span>
              {isRecording 
                ? "Recording..." 
                : isProcessing 
                  ? "Processing..." 
                  : "Press and hold to record"}
            </span>
            {/* Add loading spinner when processing */}
            {isProcessing && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
            )}
          </div>
        </div>
      </div>

      {/* Processing Overlay - show when processing */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="flex flex-col items-center space-y-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <div className="text-center">
                <h3 className="font-semibold text-lg mb-1">Processing Your Recording</h3>
                <p className="text-sm text-gray-500">
                  Please wait while we analyze your symptoms...
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Medical Report Section - only show when not processing and report is ready */}
      {!isProcessing && reportReady && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Your Medical Report</h2>
          <div className="bg-gray-100 p-4 rounded-lg">
            <p><strong>Initial Diagnosis:</strong> {medicalReport.diagnosis}</p>
          </div>
          <Button 
            className="mt-4" 
            onClick={handleContinue}
            disabled={isProcessing}
          >
            Submit Appointment Request
          </Button>
        </div>
      )}

      {/* Appointment Requests Section */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Your Appointment Requests</h2>
        {appointmentRequests.length === 0 ? (
          <p>No appointment requests yet.</p>
        ) : (
          <div className="space-y-4">
            {appointmentRequests.map((request) => (
              <div key={request.id} className="bg-white p-4 rounded-lg shadow">
                <p><strong>Status:</strong> {request.status}</p>
                <p><strong>Diagnosis:</strong> {request.diagnosis}</p>
                {request.medication && (
                  <p><strong>Medication:</strong> {request.medication}</p>
                )}
                {request.scheduledDate && toDateSafe(request.scheduledDate) && (
                  <p><strong>Scheduled Date:</strong> {format(toDateSafe(request.scheduledDate)!, 'PPP')}</p>
                )}
                {request.scheduledTime && (
                  <p><strong>Scheduled Time:</strong> {request.scheduledTime}</p>
                )}
                {/* Flagged for review prompt */}
                {request.flaggedForReview && request.status === 'pending' && (
                  <FlaggedReviewResubmission request={request} onResubmitted={fetchAppointmentRequests} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const DoctorWelcomePage = () => {
  const [appointmentRequests, setAppointmentRequests] = useState<AppointmentRequest[]>([]);
  const [assignedAppointments, setAssignedAppointments] = useState<Appointment[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<AppointmentRequest | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [date, setDate] = useState<Date | null>(new Date());
  const availableTimeSlots = ['9:00 AM', '10:00 AM', '11:00 AM', '2:00 PM', '3:00 PM', '4:00 PM'];
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);
  const [medication, setMedication] = useState<string>('');

  // Fetch all pending appointment requests
  useEffect(() => {
    const fetchAppointmentRequests = async () => {
      try {
        const q = query(
          collection(db, 'appointmentRequests'),
          where('status', '==', 'pending')
        );
        const querySnapshot = await getDocs(q);
        const requests = querySnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            ...data,
            id: doc.id,
            createdAt: data.createdAt?.toDate() || new Date(),
            scheduledDate: data.scheduledDate?.toDate() || null,
          };
        }) as AppointmentRequest[];
        // Filter out flagged requests as they are pending patient review
        const nonFlaggedRequests = requests.filter(request => !request.flaggedForReview);
        setAppointmentRequests(nonFlaggedRequests);
      } catch (error) {
        console.error("Error fetching appointment requests:", error);
        toast({
          title: "Error",
          description: "Failed to fetch appointment requests.",
        });
      }
    };

    fetchAppointmentRequests();
  }, []);

  // New effect to fetch assigned appointments
  useEffect(() => {
    const fetchAssignedAppointments = async () => {
      try {
        const currentDoctor = auth.currentUser?.displayName || 'Doctor';
        const q = query(
          collection(db, 'appointments'),
          where('assignedDoctor', '==', currentDoctor)
        );
        const querySnapshot = await getDocs(q);
        const appointments = querySnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            ...data,
            id: doc.id,
            appointmentDate: data.appointmentDate,
            appointmentTime: data.appointmentTime,
            assignedDoctor: data.assignedDoctor,
            patientUsername: data.patientUsername,
            diagnosis: data.diagnosis,
            medication: data.medication,
            // Add more fields as needed
          };
        }) as Appointment[];

        // Sort appointments by date and time
        appointments.sort((a, b) => {
          const dateA = new Date(`${a.appointmentDate} ${a.appointmentTime}`);
          const dateB = new Date(`${b.appointmentDate} ${b.appointmentTime}`);
          return dateA.getTime() - dateB.getTime();
        });

        setAssignedAppointments(appointments);
      } catch (error) {
        console.error("Error fetching assigned appointments:", error);
        toast({
          title: "Error",
          description: "Failed to fetch assigned appointments.",
        });
      }
    };

    fetchAssignedAppointments();
  }, []);

  const handleScheduleAppointment = async (request: AppointmentRequest) => {
    setSelectedRequest(request);
    setShowCalendar(true);
  };

  const handleTimeSlotClick = (slot: string) => {
    setSelectedTimeSlot(slot);
  };

  const confirmScheduling = async () => {
    if (!selectedRequest || !date || !selectedTimeSlot) {
      toast({
        title: "Error",
        description: "Please select a date and time slot.",
      });
      return;
    }

    if (!medication.trim()) {
      toast({
        title: "Error",
        description: "Please enter basic medication details.",
      });
      return;
    }

    try {
      const firestoreDate = new Date(date.getTime());
      
      // Update the appointment request
      const requestRef = doc(db, 'appointmentRequests', selectedRequest.id!);
      await updateDoc(requestRef, {
        status: 'scheduled',
        scheduledDate: firestoreDate,
        scheduledTime: selectedTimeSlot,
        medication: medication.trim(),
      });

      // Create a new appointment with medication
      const newAppointment: Appointment = {
        appointmentDate: format(firestoreDate, "PPP"),
        appointmentTime: selectedTimeSlot,
        assignedDoctor: auth.currentUser?.displayName || 'Doctor',
        patientUsername: selectedRequest.patientUsername,
        diagnosis: selectedRequest.diagnosis,
        medication: medication.trim(),
      };

      await addDoc(collection(db, 'appointments'), newAppointment);

      toast({
        title: "Success",
        description: `Appointment scheduled for ${format(firestoreDate, "PPP")} at ${selectedTimeSlot}`,
      });

      // Reset states
      setShowCalendar(false);
      setSelectedTimeSlot(null);
      setDate(null);
      setSelectedRequest(null);
      setMedication('');

      // Refresh appointment requests
      const q = query(
        collection(db, 'appointmentRequests'),
        where('status', '==', 'pending')
      );
      const querySnapshot = await getDocs(q);
      const requests = querySnapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
      })) as AppointmentRequest[];
      // Filter out flagged requests as they are pending patient review
      const nonFlaggedRequests = requests.filter(request => !request.flaggedForReview);
      setAppointmentRequests(nonFlaggedRequests);

    } catch (error) {
      console.error("Error scheduling appointment:", error);
      toast({
        title: "Error",
        description: "Failed to schedule appointment.",
      });
    }
  };

  const handleFlagForReview = async (request: AppointmentRequest) => {
    try {
      const requestRef = doc(db, 'appointmentRequests', request.id!);
      await updateDoc(requestRef, { flaggedForReview: true });
      toast({
        title: "Flagged for Review",
        description: `Patient ${request.patientUsername} has been flagged for review.`,
      });
      // Refresh appointment requests
      const q = query(
        collection(db, 'appointmentRequests'),
        where('status', '==', 'pending')
      );
      const querySnapshot = await getDocs(q);
      const requests = querySnapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
      })) as AppointmentRequest[];
      // Filter out flagged requests as they are pending patient review
      const nonFlaggedRequests = requests.filter(request => !request.flaggedForReview);
      setAppointmentRequests(nonFlaggedRequests);
    } catch (error) {
      console.error("Error flagging for review:", error);
      toast({
        title: "Error",
        description: "Failed to flag for review.",
      });
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Doctor Dashboard</h1>
      
      {/* Unassigned Patients Section */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Unassigned Patients</h2>
        {appointmentRequests.length === 0 ? (
          <p>No unassigned patients at the moment.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {appointmentRequests.map((request) => (
              <div key={request.id} className="bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow">
                <div className="mb-4">
                  <h3 className="font-semibold text-lg">{request.patientUsername}</h3>
                  <p className="text-sm text-gray-500">
                    Requested on: {format(toDateSafe(request.createdAt) || new Date(), 'PPP')}
                  </p>
                </div>
                <div className="space-y-2">
                  <div>
                    <h4 className="font-medium">AI Diagnosis:</h4>
                    <p className="text-sm">{request.diagnosis}</p>
                  </div>
                  {request.resubmissionComment && (
                    <div className="mt-2 p-2 bg-yellow-50 border-l-4 border-yellow-400 rounded">
                      <p className="text-xs text-yellow-800"><strong>Patient Comment:</strong> {request.resubmissionComment}</p>
                    </div>
                  )}
                </div>
                <Button 
                  className="mt-4 w-full"
                  onClick={() => handleScheduleAppointment(request)}
                >
                  Schedule Appointment
                </Button>
                <Button 
                  className="mt-2 w-full"
                  variant="destructive"
                  onClick={() => handleFlagForReview(request)}
                >
                  <Flag className="h-4 w-4 mr-2" />
                  Flag for review
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Assigned Patients Section */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Your Assigned Patients</h2>
        {assignedAppointments.length === 0 ? (
          <p>No assigned patients at the moment.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {assignedAppointments.map((appointment) => (
              <div key={appointment.id} className="bg-white p-4 rounded-lg shadow">
                <div className="mb-4">
                  <h3 className="font-semibold text-lg">{appointment.patientUsername}</h3>
                  <div className="mt-2 space-y-1">
                    {appointment.appointmentDate && (
                      <p className="text-sm">
                        <strong>Date:</strong> {typeof appointment.appointmentDate === 'string' ? appointment.appointmentDate : (toDateSafe(appointment.appointmentDate) ? format(toDateSafe(appointment.appointmentDate)!, 'PPP') : '')}
                      </p>
                    )}
                    {appointment.appointmentTime && (
                      <p className="text-sm">
                        <strong>Time:</strong> {appointment.appointmentTime}
                      </p>
                    )}
                    {appointment.scheduledDate && toDateSafe(appointment.scheduledDate) && (
                      <p className="text-sm">
                        <strong>Scheduled Date:</strong> {format(toDateSafe(appointment.scheduledDate)!, 'PPP')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div>
                    <h4 className="font-medium">Diagnosis:</h4>
                    <p className="text-sm">{appointment.diagnosis}</p>
                  </div>
                  <div>
                    <h4 className="font-medium">Medication:</h4>
                    <p className="text-sm">{appointment.medication}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scheduling Modal */}
      {showCalendar && selectedRequest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg max-w-md w-full">
            <h3 className="text-xl font-semibold mb-4">Schedule Appointment</h3>
            <div className="mb-4">
              <p><strong>Patient:</strong> {selectedRequest.patientUsername}</p>
              <p><strong>AI Diagnosis:</strong> {selectedRequest.diagnosis}</p>
            </div>
            
            <div className="mb-4">
              <Calendar
                mode="single"
                selected={date ?? undefined}
                onSelect={d => setDate(d ?? null)}
                disabled={d => d < new Date()}
                initialFocus
              />
            </div>

            {date && (
              <div className="mb-4">
                <h4 className="text-sm font-semibold mb-2">Available Time Slots:</h4>
                <div className="grid grid-cols-2 gap-2">
                  {availableTimeSlots.map(slot => (
                    <Button
                      key={slot}
                      variant={selectedTimeSlot === slot ? "default" : "outline"}
                      onClick={() => handleTimeSlotClick(slot)}
                      className="w-full"
                    >
                      {slot}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <label htmlFor="medication" className="block text-sm font-semibold mb-2">
                Basic Medication
              </label>
              <textarea
                id="medication"
                className="w-full px-3 py-2 border rounded-md text-sm"
                rows={3}
                placeholder="Enter basic medication details..."
                value={medication}
                onChange={(e) => setMedication(e.target.value)}
              />
            </div>

            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => {
                setShowCalendar(false);
                setSelectedRequest(null);
                setSelectedTimeSlot(null);
                setDate(null);
                setMedication('');
              }}>
                Cancel
              </Button>
              <Button 
                onClick={confirmScheduling}
                disabled={!selectedTimeSlot || !medication.trim()}
              >
                Confirm Schedule
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function FlaggedReviewResubmission({ request, onResubmitted }: { request: AppointmentRequest, onResubmitted: () => void }) {
  const [symptoms, setSymptoms] = useState(request.symptoms || '');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);

  const handleResubmit = async () => {
    setLoading(true);
    try {
      const requestRef = doc(db, 'appointmentRequests', request.id!);
      await updateDoc(requestRef, {
        symptoms,
        flaggedForReview: false,
        resubmissionComment: comment,
      });
      toast({
        title: 'Resubmitted',
        description: 'Your symptoms have been resubmitted for review.',
      });
      onResubmitted();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to resubmit symptoms.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 p-4 border border-yellow-400 bg-yellow-50 rounded">
      <p className="font-semibold text-yellow-800 mb-2">Your symptoms have been flagged for review. Please check and resubmit with comments.</p>
      <div className="mb-2">
        <label className="block text-sm font-medium mb-1">Symptoms</label>
        <textarea
          className="w-full border rounded p-2 text-sm"
          rows={3}
          value={symptoms}
          onChange={e => setSymptoms(e.target.value)}
        />
      </div>
      <div className="mb-2">
        <label className="block text-sm font-medium mb-1">Comments (optional)</label>
        <textarea
          className="w-full border rounded p-2 text-sm"
          rows={2}
          value={comment}
          onChange={e => setComment(e.target.value)}
        />
      </div>
      <Button className="mt-2" onClick={handleResubmit} disabled={loading || !symptoms.trim()}>
        {loading ? 'Resubmitting...' : 'Resubmit Symptoms'}
      </Button>
    </div>
  );
}

export default function WelcomePage() {
  const [userType, setUserType] = useState<string | null>(null);

  useEffect(() => {
    const fetchUserType = async () => {
      const user = auth.currentUser;
      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(userDocRef);

        if (docSnap.exists()) {
          setUserType(docSnap.data().userType || null);
        } else {
          setUserType(null);
        }
      }
    };

    fetchUserType();
  }, []);

  return (
    <>
      {userType === 'patient' ? <PatientWelcomePage /> : userType === 'doctor' ? <DoctorWelcomePage /> : <p>Loading...</p>}
    </>

  );
}
