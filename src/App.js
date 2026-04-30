import React, { useState, useEffect } from 'react';
import { Mic, Plus, Calendar, Phone, Building2, Filter, Bell, Search, X, FileText, Upload } from 'lucide-react';

export default function LeadTracker() {
  const [leads, setLeads] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [notification, setNotification] = useState(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    company: '',
    status: 'cold',
    painPoints: '',
    callNotes: '',
    followUpDate: ''
  });

  // Load leads from storage on mount
  useEffect(() => {
    const loadLeads = async () => {
      try {
        const stored = await window.storage.get('leads');
        if (stored?.value) {
          setLeads(JSON.parse(stored.value));
        }
      } catch (error) {
        console.log('No existing leads found, starting fresh');
      }
    };
    loadLeads();
  }, []);

  // Save leads to storage whenever they change
  useEffect(() => {
    if (leads.length > 0) {
      window.storage.set('leads', JSON.stringify(leads));
    }
  }, [leads]);

  // Check for follow-up reminders
  useEffect(() => {
    const checkReminders = () => {
      const today = new Date().toISOString().split('T')[0];
      const overdue = leads.filter(lead => 
        lead.followUpDate && 
        lead.followUpDate <= today && 
        lead.status !== 'closed'
      );
      
      if (overdue.length > 0 && Notification.permission === 'granted') {
        const msg = overdue.length === 1 
          ? `Follow up with ${overdue[0].name}` 
          : `${overdue.length} follow-ups due today`;
        
        new Notification('Lead Tracker Reminder', { body: msg });
      }
    };

    // Request notification permission
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Check on mount and every hour
    checkReminders();
    const interval = setInterval(checkReminders, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [leads]);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleVoiceRecord = async () => {
    // eslint-disable-next-line no-undef
    if (!('webkitSpeechRecognition' in window)) {
      showNotification('Voice recording not supported in this browser', 'error');
      return;
    }

    // eslint-disable-next-line no-undef
    const recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsRecording(true);
    };

    recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;
      setIsRecording(false);
      await processTextToLead(transcript);
    };

    recognition.onerror = () => {
      setIsRecording(false);
      showNotification('Voice recording failed', 'error');
    };

    recognition.start();
  };

  const processTextToLead = async (text) => {
    setIsProcessing(true);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `Extract lead information from this text (could be a call note, email, or transcript) and return ONLY a JSON object with these exact fields: name, phone, company, status (must be one of: cold, warm, hot, closed - infer from context), painPoints, callNotes, followUpDate (YYYY-MM-DD format or empty string). If a field is not mentioned, use empty string. Be smart about extracting context - if it's an email reply, note their interest level. If it's a transcript, summarize key points. Here's the text: "${text}"`
          }]
        })
      });

      const data = await response.json();
      const responseText = data.content.find(c => c.type === 'text')?.text || '{}';
      const cleanText = responseText.replace(/```json|```/g, '').trim();
      const extracted = JSON.parse(cleanText);

      setFormData({
        name: extracted.name || '',
        phone: extracted.phone || '',
        company: extracted.company || '',
        status: extracted.status || 'cold',
        painPoints: extracted.painPoints || '',
        callNotes: extracted.callNotes || text.substring(0, 500),
        followUpDate: extracted.followUpDate || ''
      });
      setShowAddForm(true);
      setShowImportModal(false);
      setImportText('');
      setIsProcessing(false);
      showNotification('Import processed! Review and save.');
    } catch (error) {
      setIsProcessing(false);
      showNotification('Error processing import', 'error');
      console.error(error);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      await processTextToLead(text);
    };
    reader.readAsText(file);
  };

  const handleImportSubmit = async () => {
    if (!importText.trim()) {
      showNotification('Please paste some text to import', 'error');
      return;
    }
    await processTextToLead(importText);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newLead = {
      ...formData,
      id: Date.now(),
      createdAt: new Date().toISOString()
    };
    
    // Send to Google Sheets via Zapier webhook
    try {
      await fetch('https://hooks.zapier.com/hooks/catch/27399450/uv8w79c/', {
        method: 'POST',
        body: JSON.stringify({
          name: newLead.name,
          phone: newLead.phone,
          company: newLead.company,
          status: newLead.status,
          painPoints: newLead.painPoints,
          callNotes: newLead.callNotes,
          followUpDate: newLead.followUpDate,
          createdAt: newLead.createdAt
        })
      });
    } catch (error) {
      console.log('Failed to sync to Google Sheets:', error);
      // Continue anyway - don't block the user
    }
    
    setLeads([newLead, ...leads]);
    setFormData({
      name: '', phone: '', company: '', status: 'cold',
      painPoints: '', callNotes: '', followUpDate: ''
    });
    setShowAddForm(false);
    showNotification('Lead added successfully!');
  };

  const updateLeadStatus = (id, newStatus) => {
    setLeads(leads.map(lead => 
      lead.id === id ? { ...lead, status: newStatus } : lead
    ));
    showNotification('Status updated');
  };

  const deleteLead = (id) => {
    // eslint-disable-next-line no-restricted-globals
    if (confirm('Delete this lead?')) {
      setLeads(leads.filter(lead => lead.id !== id));
      showNotification('Lead deleted');
    }
  };

  // Filter leads
  const filteredLeads = leads.filter(lead => {
    const matchesStatus = filterStatus === 'all' || lead.status === filterStatus;
    const matchesSearch = !searchTerm || 
      lead.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.company?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // Get today's follow-ups
  const today = new Date().toISOString().split('T')[0];
  const todayFollowUps = leads.filter(lead => 
    lead.followUpDate === today && lead.status !== 'closed'
  );
  const overdueFollowUps = leads.filter(lead => 
    lead.followUpDate && lead.followUpDate < today && lead.status !== 'closed'
  );

  const statusColors = {
    cold: 'bg-blue-100 text-blue-800',
    warm: 'bg-yellow-100 text-yellow-800',
    hot: 'bg-red-100 text-red-800',
    closed: 'bg-gray-100 text-gray-800'
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Lead Tracker</h1>
              <p className="text-slate-600 mt-1">Voice-powered CRM for busy consultants</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleVoiceRecord}
                disabled={isRecording || isProcessing}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                  isRecording 
                    ? 'bg-red-500 text-white animate-pulse' 
                    : isProcessing
                    ? 'bg-slate-400 text-white cursor-wait'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                <Mic size={20} />
                {isRecording ? 'Recording...' : isProcessing ? 'Processing...' : 'Voice Note'}
              </button>
              <button
                onClick={() => setShowImportModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-all"
              >
                <FileText size={20} />
                Import
              </button>
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg font-medium hover:bg-slate-800 transition-all"
              >
                <Plus size={20} />
                Add Lead
              </button>
            </div>
          </div>

          {/* Follow-up alerts */}
          {(todayFollowUps.length > 0 || overdueFollowUps.length > 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Bell className="text-amber-600 mt-0.5" size={20} />
                <div className="flex-1">
                  <p className="font-medium text-amber-900">Follow-up Reminders</p>
                  {todayFollowUps.length > 0 && (
                    <p className="text-sm text-amber-800 mt-1">
                      {todayFollowUps.length} due today: {todayFollowUps.map(l => l.name).join(', ')}
                    </p>
                  )}
                  {overdueFollowUps.length > 0 && (
                    <p className="text-sm text-amber-800 mt-1">
                      {overdueFollowUps.length} overdue: {overdueFollowUps.map(l => l.name).join(', ')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          <div className="flex gap-4 items-center flex-wrap">
            <div className="flex items-center gap-2">
              <Filter size={20} className="text-slate-600" />
              <span className="text-sm font-medium text-slate-700">Filter:</span>
            </div>
            {['all', 'cold', 'warm', 'hot', 'closed'].map(status => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
                  filterStatus === status
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
            <div className="flex-1 max-w-xs ml-auto">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search leads..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Import Modal */}
        {showImportModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold text-slate-900">Import Lead</h2>
                  <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600">
                    <X size={24} />
                  </button>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Paste Email, Transcript, or Notes
                    </label>
                    <textarea
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder="Paste an email reply, call transcript, or meeting notes here...

Examples:
• Email: Subject line + body from a prospect reply
• Transcript: Zoom/Teams auto-transcript or voice memo transcription
• Notes: Any text about a lead or conversation"
                      rows={12}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    />
                  </div>

                  <div className="border-t border-slate-200 pt-4">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Or Upload a File
                    </label>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 cursor-pointer transition-all">
                        <Upload size={18} />
                        Choose File
                        <input
                          type="file"
                          accept=".txt,.eml,.doc,.docx"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </label>
                      <span className="text-sm text-slate-500">Accepts: .txt, .eml, .doc, .docx</span>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleImportSubmit}
                      disabled={isProcessing || !importText.trim()}
                      className={`flex-1 py-2 rounded-lg font-medium transition-all ${
                        isProcessing || !importText.trim()
                          ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                          : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      {isProcessing ? 'Processing...' : 'Process Import'}
                    </button>
                    <button
                      onClick={() => setShowImportModal(false)}
                      className="px-6 bg-slate-200 text-slate-700 py-2 rounded-lg font-medium hover:bg-slate-300 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Add/Edit Form Modal */}
        {showAddForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold text-slate-900">Add New Lead</h2>
                  <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600">
                    <X size={24} />
                  </button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({...formData, phone: e.target.value})}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Company</label>
                      <input
                        type="text"
                        value={formData.company}
                        onChange={(e) => setFormData({...formData, company: e.target.value})}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({...formData, status: e.target.value})}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="cold">Cold</option>
                        <option value="warm">Warm</option>
                        <option value="hot">Hot</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Pain Points</label>
                    <textarea
                      value={formData.painPoints}
                      onChange={(e) => setFormData({...formData, painPoints: e.target.value})}
                      rows={2}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Call Notes</label>
                    <textarea
                      value={formData.callNotes}
                      onChange={(e) => setFormData({...formData, callNotes: e.target.value})}
                      rows={3}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Follow-up Date</label>
                    <input
                      type="date"
                      value={formData.followUpDate}
                      onChange={(e) => setFormData({...formData, followUpDate: e.target.value})}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button
                      type="submit"
                      className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 transition-all"
                    >
                      Save Lead
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddForm(false)}
                      className="px-6 bg-slate-200 text-slate-700 py-2 rounded-lg font-medium hover:bg-slate-300 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Leads List */}
        <div className="space-y-3">
          {filteredLeads.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-12 text-center">
              <p className="text-slate-500">No leads found. Add your first lead to get started!</p>
            </div>
          ) : (
            filteredLeads.map(lead => (
              <div key={lead.id} className="bg-white rounded-lg shadow-sm p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-slate-900">{lead.name}</h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[lead.status]}`}>
                        {lead.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex gap-4 text-sm text-slate-600">
                      {lead.phone && (
                        <div className="flex items-center gap-1">
                          <Phone size={14} />
                          <span>{lead.phone}</span>
                        </div>
                      )}
                      {lead.company && (
                        <div className="flex items-center gap-1">
                          <Building2 size={14} />
                          <span>{lead.company}</span>
                        </div>
                      )}
                      {lead.followUpDate && (
                        <div className="flex items-center gap-1">
                          <Calendar size={14} />
                          <span className={
                            lead.followUpDate < today ? 'text-red-600 font-medium' :
                            lead.followUpDate === today ? 'text-amber-600 font-medium' :
                            ''
                          }>
                            {lead.followUpDate}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={lead.status}
                      onChange={(e) => updateLeadStatus(lead.id, e.target.value)}
                      className="px-3 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="cold">Cold</option>
                      <option value="warm">Warm</option>
                      <option value="hot">Hot</option>
                      <option value="closed">Closed</option>
                    </select>
                    <button
                      onClick={() => deleteLead(lead.id)}
                      className="px-3 py-1 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {lead.painPoints && (
                  <div className="mb-2">
                    <p className="text-sm font-medium text-slate-700">Pain Points:</p>
                    <p className="text-sm text-slate-600">{lead.painPoints}</p>
                  </div>
                )}
                {lead.callNotes && (
                  <div>
                    <p className="text-sm font-medium text-slate-700">Notes:</p>
                    <p className="text-sm text-slate-600">{lead.callNotes}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Notification Toast */}
        {notification && (
          <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white ${
            notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'
          }`}>
            {notification.message}
          </div>
        )}
      </div>
    </div>
  );
}
