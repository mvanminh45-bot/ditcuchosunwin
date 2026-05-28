const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL = 'https://sun-win.onrender.com/api/history';
const LEARNING_FILE = 'learning_data.json';
const HISTORY_FILE = 'prediction_history.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

let learningData = {
  hu: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: []
  },
  md5: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: []
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.0,
  'cau_dao_11': 1.0,
  'cau_22': 1.0,
  'cau_33': 1.0,
  'cau_121': 1.0,
  'cau_123': 1.0,
  'cau_321': 1.0,
  'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.0,
  'cau_3van1': 1.0,
  'cau_be_cau': 1.0,
  'cau_chu_ky': 1.0,
  'distribution': 1.0,
  'dice_pattern': 1.0,
  'sum_trend': 1.0,
  'edge_cases': 1.0,
  'momentum': 1.0,
  'cau_tu_nhien': 1.0,
  'dice_trend_line': 1.0,
  'dice_trend_line_md5': 1.0,
  'break_pattern_hu': 1.0,
  'break_pattern_md5': 1.0,
  'fibonacci': 1.0,
  'resistance_support': 1.0,
  'wave': 1.0,
  'golden_ratio': 1.0,
  'day_gay': 1.0,
  'day_gay_md5': 1.0,
  'cau_44': 1.0,
  'cau_55': 1.0,
  'cau_212': 1.0,
  'cau_1221': 1.0,
  'cau_2112': 1.0,
  'cau_gap': 1.0,
  'cau_ziczac': 1.0,
  'cau_doi': 1.0,
  'cau_rong': 1.0,
  'smart_bet': 1.0
};

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      console.log('Learning data loaded successfully');
    }
  } catch (error) {
    console.error('Error loading learning data:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('Error saving learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('Prediction history loaded successfully');
      console.log(`  - Hu: ${predictionHistory.hu.length} records`);
      console.log(`  - MD5: ${predictionHistory.md5.length} records`);
    }
  } catch (error) {
    console.error('Error loading prediction history:', error.message);
  }
}

function savePredictionHistory() {
  try {
    const dataToSave = {
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(dataToSave, null, 2));
  } catch (error) {
    console.error('Error saving prediction history:', error.message);
  }
}

async function autoProcessPredictions() {
  try {
    const data = await fetchData();
    if (!data) return;
    
    if (data.taixiu && data.taixiu.length > 0) {
      const latestHuPhien = data.taixiu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyPredictions('hu', data.taixiu);
        
        const result = calculateAdvancedPrediction(data.taixiu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] Hu phien ${nextHuPhien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    
    if (data.taixiumd5 && data.taixiumd5.length > 0) {
      const latestMd5Phien = data.taixiumd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', data.taixiumd5);
        
        const result = calculateAdvancedPrediction(data.taixiumd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
        
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[Auto] MD5 phien ${nextMd5Phien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    
    savePredictionHistory();
    saveLearningData();
    
  } catch (error) {
    console.error('[Auto] Error processing predictions:', error.message);
  }
}

function startAutoSaveTask() {
  console.log(`Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
  
  setTimeout(() => {
    autoProcessPredictions();
  }, 5000);
  
  setInterval(() => {
    autoProcessPredictions();
  }, AUTO_SAVE_INTERVAL);
}

function initializePatternStats(type) {
  if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
    if (!learningData[type].patternStats[pattern]) {
      learningData[type].patternStats[pattern] = {
        total: 0,
        correct: 0,
        accuracy: 0.5,
        recentResults: [],
        lastAdjustment: null
      };
    }
  });
}

function getPatternWeight(type, patternId) {
  initializePatternStats(type);
  return learningData[type].patternWeights[patternId] || 1.0;
}

function updatePatternPerformance(type, patternId, isCorrect) {
  initializePatternStats(type);
  
  const stats = learningData[type].patternStats[patternId];
  if (!stats) return;
  
  stats.total++;
  if (isCorrect) stats.correct++;
  
  stats.recentResults.push(isCorrect ? 1 : 0);
  if (stats.recentResults.length > 20) {
    stats.recentResults.shift();
  }
  
  const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
  
  const oldWeight = learningData[type].patternWeights[patternId];
  let newWeight = oldWeight;
  
  if (stats.recentResults.length >= 5) {
    if (recentAccuracy > 0.6) {
      newWeight = Math.min(2.0, oldWeight * 1.05);
    } else if (recentAccuracy < 0.4) {
      newWeight = Math.max(0.3, oldWeight * 0.95);
    }
  }
  
  learningData[type].patternWeights[patternId] = newWeight;
  stats.lastAdjustment = new Date().toISOString();
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  const record = {
    phien: phien.toString(),
    prediction,
    confidence,
    patterns,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };
  
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  
  if (learningData[type].predictions.length > 500) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 500);
  }
  
  saveLearningData();
}

async function verifyPredictions(type, currentData) {
  let updated = false;
  
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    
    const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actualResult) {
      pred.verified = true;
      pred.actual = actualResult.Ket_qua;
      
      const predictedNormalized = pred.prediction === 'Tài' || pred.prediction === 'tai' ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === predictedNormalized;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        
        if (learningData[type].streakAnalysis.currentStreak >= 0) {
          learningData[type].streakAnalysis.currentStreak++;
        } else {
          learningData[type].streakAnalysis.currentStreak = 1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.losses++;
        
        if (learningData[type].streakAnalysis.currentStreak <= 0) {
          learningData[type].streakAnalysis.currentStreak--;
        } else {
          learningData[type].streakAnalysis.currentStreak = -1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 50) {
        learningData[type].recentAccuracy.shift();
      }
      
      if (pred.patterns && pred.patterns.length > 0) {
        pred.patterns.forEach(patternName => {
          const patternId = getPatternIdFromName(patternName);
          if (patternId) {
            updatePatternPerformance(type, patternId, pred.isCorrect);
          }
        });
      }
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet',
    'Cầu Đảo 1-1': 'cau_dao_11',
    'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33',
    'Cầu 4-4': 'cau_44',
    'Cầu 5-5': 'cau_55',
    'Cầu 1-2-1': 'cau_121',
    'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321',
    'Cầu 2-1-2': 'cau_212',
    'Cầu 1-2-2-1': 'cau_1221',
    'Cầu 1-2-1-2-1': 'cau_1221',
    'Cầu 2-1-1-2': 'cau_2112',
    'Cầu Nhảy Cóc': 'cau_nhay_coc',
    'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng',
    'Cầu 3 Ván 1': 'cau_3van1',
    'Cầu Bẻ Cầu': 'cau_be_cau',
    'Cầu Chu Kỳ': 'cau_chu_ky',
    'Cầu Gấp': 'cau_gap',
    'Cầu Ziczac': 'cau_ziczac',
    'Cầu Đôi': 'cau_doi',
    'Cầu Rồng': 'cau_rong',
    'Đảo Xu Hướng': 'smart_bet',
    'Xu Hướng Cực': 'smart_bet',
    'Phân bố': 'distribution',
    'Tổng TB': 'dice_pattern',
    'Xu hướng': 'sum_trend',
    'Cực Điểm': 'edge_cases',
    'Biến động': 'momentum',
    'Cầu Tự Nhiên': 'cau_tu_nhien',
    'Biểu Đồ Đường': 'dice_trend_line',
    'MD5 Biểu Đồ': 'dice_trend_line_md5',
    'Cầu Liên Tục': 'break_pattern_hu',
    'MD5 Cầu': 'break_pattern_md5',
    'Dây Gãy': 'day_gay',
    'MD5 Dây Gãy': 'day_gay_md5'
  };
  
  for (const [key, value] of Object.entries(mapping)) {
    if (name.includes(key)) return value;
  }
  return null;
}

function getAdaptiveConfidenceBoost(type) {
  const recentAcc = learningData[type].recentAccuracy;
  if (recentAcc.length < 10) return 0;
  
  const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
  
  if (accuracy > 0.65) return 5;
  if (accuracy > 0.55) return 2;
  if (accuracy < 0.4) return -5;
  if (accuracy < 0.45) return -2;
  
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streakInfo = learningData[type].streakAnalysis;
  
  if (streakInfo.currentStreak <= -5) {
    return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  }
  
  let taiPatternScore = 0;
  let xiuPatternScore = 0;
  
  patterns.forEach(p => {
    const patternId = getPatternIdFromName(p.name || p);
    if (patternId) {
      const stats = learningData[type].patternStats[patternId];
      if (stats && stats.recentResults.length >= 5) {
        const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
        const weight = learningData[type].patternWeights[patternId] || 1;
        
        if (p.prediction === 'Tài') {
          taiPatternScore += recentAcc * weight;
        } else {
          xiuPatternScore += recentAcc * weight;
        }
      }
    }
  });
  
  if (Math.abs(taiPatternScore - xiuPatternScore) > 0.5) {
    return taiPatternScore > xiuPatternScore ? 'Tài' : 'Xỉu';
  }
  
  return prediction;
}

function normalizeResult(result) {
  if (result === 'Tài' || result === 'tài') return 'tai';
  if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
  return result.toLowerCase();
}

async function fetchData() {
  try {
    const response = await axios.get(API_URL);
    return response.data;
  } catch (error) {
    console.error('Error fetching data:', error.message);
    return null;
  }
}

function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  
  let streakType = results[0];
  let streakLength = 1;
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 3) {
    const weight = getPatternWeight(type, 'cau_bet');
    const stats = learningData[type].patternStats['cau_bet'];
    
    let shouldBreak = streakLength >= 6;
    
    if (stats && stats.recentResults.length >= 5) {
      const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
      if (recentAcc < 0.4) {
        shouldBreak = !shouldBreak;
      }
    }
    
    return { 
      detected: true, 
      type: streakType, 
      length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round((shouldBreak ? Math.min(12, streakLength * 2) : Math.min(15, streakLength * 3)) * weight),
      name: `Cầu Bệt ${streakLength} phiên`,
      patternId: 'cau_bet'
    };
  }
  
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i - 1]) {
      alternatingLength++;
    } else {
      break;
    }
  }
  
  if (alternatingLength >= 4) {
    const weight = getPatternWeight(type, 'cau_dao_11');
    return { 
      detected: true, 
      length: alternatingLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(14, alternatingLength * 2 + 4) * weight),
      name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`,
      patternId: 'cau_dao_11'
    };
  }
  
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  
  let pairCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 1 && pairCount < 4) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else {
      break;
    }
  }
  
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) {
        isAlternating = false;
        break;
      }
    }
    
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      const weight = getPatternWeight(type, 'cau_22');
      
      return { 
        detected: true, 
        pairCount,
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(12, pairCount * 3 + 3) * weight),
        name: `Cầu 2-2 (${pairCount} cặp)`,
        patternId: 'cau_22'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  
  let tripleCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else {
      break;
    }
  }
  
  if (tripleCount >= 1) {
    const currentPosition = results.length % 3;
    const lastTripleType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_33');
    
    let prediction;
    if (currentPosition === 0) {
      prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastTripleType;
    }
    
    return { 
      detected: true, 
      tripleCount,
      prediction,
      confidence: Math.round(Math.min(13, tripleCount * 4 + 5) * weight),
      name: `Cầu 3-3 (${tripleCount} bộ ba)`,
      patternId: 'cau_33'
    };
  }
  
  return { detected: false };
}

function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  
  const pattern1 = results.slice(0, 4);
  
  if (pattern1[0] !== pattern1[1] && 
      pattern1[1] === pattern1[2] && 
      pattern1[2] !== pattern1[3] &&
      pattern1[0] === pattern1[3]) {
    const weight = getPatternWeight(type, 'cau_121');
    return { 
      detected: true, 
      pattern: '1-2-1',
      prediction: pattern1[0],
      confidence: Math.round(10 * weight),
      name: 'Cầu 1-2-1',
      patternId: 'cau_121'
    };
  }
  
  return { detected: false };
}

function analyzeCau123(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first = results[5];
  const nextTwo = results.slice(3, 5);
  const lastThree = results.slice(0, 3);
  
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      const weight = getPatternWeight(type, 'cau_123');
      return { 
        detected: true, 
        pattern: '1-2-3',
        prediction: first,
        confidence: Math.round(11 * weight),
        name: 'Cầu 1-2-3',
        patternId: 'cau_123'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau321(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first3 = results.slice(3, 6);
  const next2 = results.slice(1, 3);
  const last1 = results[0];
  
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    const weight = getPatternWeight(type, 'cau_321');
    return { 
      detected: true, 
      pattern: '3-2-1',
      prediction: next2[0],
      confidence: Math.round(12 * weight),
      name: 'Cầu 3-2-1',
      patternId: 'cau_321'
    };
  }
  
  return { detected: false };
}

function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) {
    skipPattern.push(results[i]);
  }
  
  if (skipPattern.length >= 3) {
    const weight = getPatternWeight(type, 'cau_nhay_coc');
    const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0],
        confidence: Math.round(8 * weight),
        name: 'Cầu Nhảy Cóc',
        patternId: 'cau_nhay_coc'
      };
    }
    
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) {
      if (skipPattern[i] === skipPattern[i - 1]) {
        alternating = false;
        break;
      }
    }
    
    if (alternating && skipPattern.length >= 3) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(7 * weight),
        name: 'Cầu Nhảy Cóc Đảo',
        patternId: 'cau_nhay_coc'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_nhip_nghieng');
  
  if (taiCount5 >= 4) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      ratio: `${taiCount5}/5 Tài`,
      prediction: 'Tài',
      confidence: Math.round(9 * weight),
      name: `Cầu Nhịp Nghiêng 5 (${taiCount5} Tài)`,
      patternId: 'cau_nhip_nghieng'
    };
  } else if (taiCount5 <= 1) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      ratio: `${5 - taiCount5}/5 Xỉu`,
      prediction: 'Xỉu',
      confidence: Math.round(9 * weight),
      name: `Cầu Nhịp Nghiêng 5 (${5 - taiCount5} Xỉu)`,
      patternId: 'cau_nhip_nghieng'
    };
  }
  
  if (results.length >= 7) {
    const last7 = results.slice(0, 7);
    const taiCount7 = last7.filter(r => r === 'Tài').length;
    
    if (taiCount7 >= 5) {
      return { 
        detected: true, 
        type: 'nghieng_7',
        ratio: `${taiCount7}/7 Tài`,
        prediction: 'Tài',
        confidence: Math.round(10 * weight),
        name: `Cầu Nhịp Nghiêng 7 (${taiCount7} Tài)`,
        patternId: 'cau_nhip_nghieng'
      };
    } else if (taiCount7 <= 2) {
      return { 
        detected: true, 
        type: 'nghieng_7',
        ratio: `${7 - taiCount7}/7 Xỉu`,
        prediction: 'Xỉu',
        confidence: Math.round(10 * weight),
        name: `Cầu Nhịp Nghiêng 7 (${7 - taiCount7} Xỉu)`,
        patternId: 'cau_nhip_nghieng'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_3van1');
  
  if (taiCount === 3) {
    return { 
      detected: true, 
      pattern: '3-1',
      majority: 'Tài',
      prediction: 'Xỉu',
      confidence: Math.round(8 * weight),
      name: 'Cầu 3 Ván 1 (3T-1X)',
      patternId: 'cau_3van1'
    };
  } else if (taiCount === 1) {
    return { 
      detected: true, 
      pattern: '3-1',
      majority: 'Xỉu',
      prediction: 'Tài',
      confidence: Math.round(8 * weight),
      name: 'Cầu 3 Ván 1 (3X-1T)',
      patternId: 'cau_3van1'
    };
  }
  
  return { detected: false };
}

function analyzeCauBeCau(results, type) {
  if (results.length < 8) return { detected: false };
  
  const recentStreak = analyzeCauBet(results, type);
  
  if (recentStreak.detected && recentStreak.length >= 4) {
    const beforeStreak = results.slice(recentStreak.length, recentStreak.length + 4);
    const previousPattern = analyzeCauBet(beforeStreak, type);
    
    if (previousPattern.detected && previousPattern.type !== recentStreak.type) {
      const weight = getPatternWeight(type, 'cau_be_cau');
      return { 
        detected: true, 
        pattern: 'be_cau',
        prediction: recentStreak.type === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(11 * weight),
        name: 'Cầu Bẻ Cầu',
        patternId: 'cau_be_cau'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauTuNhien(results, type) {
  if (results.length < 2) return { detected: false };
  const weight = getPatternWeight(type, 'cau_tu_nhien');
  
  return { 
    detected: true, 
    prediction: results[0],
    confidence: Math.round(5 * weight),
    name: 'Cầu Tự Nhiên (Theo Ván Trước)',
    patternId: 'cau_tu_nhien'
  };
}

function analyzeCau44(results, type) {
  if (results.length < 8) return { detected: false };
  
  let quadCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 3) {
    if (results[i] === results[i + 1] && 
        results[i + 1] === results[i + 2] && 
        results[i + 2] === results[i + 3]) {
      pattern.push(results[i]);
      quadCount++;
      i += 4;
    } else {
      break;
    }
  }
  
  if (quadCount >= 1) {
    const currentPosition = (results.length - (quadCount * 4));
    const lastQuadType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_44');
    
    let prediction;
    if (currentPosition >= 3) {
      prediction = lastQuadType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastQuadType;
    }
    
    return { 
      detected: true, 
      quadCount,
      prediction,
      confidence: Math.round(Math.min(14, quadCount * 4 + 6) * weight),
      name: `Cầu 4-4 (${quadCount} bộ bốn)`,
      patternId: 'cau_44'
    };
  }
  
  return { detected: false };
}

function analyzeCau212(results, type) {
  if (results.length < 5) return { detected: false };
  
  const pattern = results.slice(0, 5);
  const weight = getPatternWeight(type, 'cau_212');
  
  if (pattern[0] === pattern[1] && 
      pattern[1] !== pattern[2] &&
      pattern[2] === pattern[3] && pattern[3] === pattern[4] &&
      pattern[0] !== pattern[2]) {
    return { 
      detected: true, 
      pattern: '2-1-2',
      prediction: pattern[0],
      confidence: Math.round(11 * weight),
      name: 'Cầu 2-1-2',
      patternId: 'cau_212'
    };
  }
  
  if (pattern[0] !== pattern[1] && pattern[1] !== pattern[2] &&
      pattern[0] === pattern[2] &&
      pattern[2] !== pattern[3] &&
      pattern[3] === pattern[4]) {
    return { 
      detected: true, 
      pattern: '2-1-2 (đảo)',
      prediction: pattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(10 * weight),
      name: 'Cầu 2-1-2 Đảo',
      patternId: 'cau_212'
    };
  }
  
  return { detected: false };
}

function analyzeCau1221(results, type) {
  if (results.length < 6) return { detected: false };
  
  const pattern = results.slice(0, 6);
  const weight = getPatternWeight(type, 'cau_1221');
  
  if (pattern[0] !== pattern[1] &&
      pattern[1] === pattern[2] &&
      pattern[2] === pattern[3] &&
      pattern[3] !== pattern[4] &&
      pattern[4] === pattern[5] &&
      pattern[0] !== pattern[1]) {
    return { 
      detected: true, 
      pattern: '1-2-2-1',
      prediction: pattern[0],
      confidence: Math.round(12 * weight),
      name: 'Cầu 1-2-2-1',
      patternId: 'cau_1221'
    };
  }
  
  if (pattern[0] !== pattern[1] &&
      pattern[1] === pattern[2] &&
      pattern[2] !== pattern[3] &&
      pattern[3] === pattern[4] &&
      pattern[4] !== pattern[5]) {
    return { 
      detected: true, 
      pattern: '1-2-1-2-1',
      prediction: pattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(11 * weight),
      name: 'Cầu 1-2-1-2-1',
      patternId: 'cau_1221'
    };
  }
  
  return { detected: false };
}

function analyzeCau55(results, type) {
  if (results.length < 10) return { detected: false };
  
  let quintCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 4) {
    if (results[i] === results[i + 1] && 
        results[i + 1] === results[i + 2] && 
        results[i + 2] === results[i + 3] &&
        results[i + 3] === results[i + 4]) {
      pattern.push(results[i]);
      quintCount++;
      i += 5;
    } else {
      break;
    }
  }
  
  if (quintCount >= 1) {
    const currentPosition = (results.length - (quintCount * 5));
    const lastQuintType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_55');
    
    let prediction;
    if (currentPosition >= 4) {
      prediction = lastQuintType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastQuintType;
    }
    
    return { 
      detected: true, 
      quintCount,
      prediction,
      confidence: Math.round(Math.min(15, quintCount * 5 + 7) * weight),
      name: `Cầu 5-5 (${quintCount} bộ năm)`,
      patternId: 'cau_55'
    };
  }
  
  return { detected: false };
}

function analyzeCau2112(results, type) {
  if (results.length < 6) return { detected: false };
  
  const pattern = results.slice(0, 6);
  const weight = getPatternWeight(type, 'cau_2112');
  
  if (pattern[0] === pattern[1] &&
      pattern[1] !== pattern[2] &&
      pattern[2] === pattern[3] &&
      pattern[3] !== pattern[4] &&
      pattern[4] === pattern[5] &&
      pattern[0] !== pattern[2]) {
    return { 
      detected: true, 
      pattern: '2-1-1-2',
      prediction: pattern[0],
      confidence: Math.round(11 * weight),
      name: 'Cầu 2-1-1-2',
      patternId: 'cau_2112'
    };
  }
  
  return { detected: false };
}

function analyzeCauGap(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_gap');
  
  for (let gapSize = 2; gapSize <= 3; gapSize++) {
    let patternFound = true;
    const referenceType = results[0];
    
    for (let i = 0; i < Math.min(results.length, 12); i += (gapSize + 1)) {
      if (results[i] !== referenceType) {
        patternFound = false;
        break;
      }
    }
    
    if (patternFound) {
      return { 
        detected: true, 
        gapSize,
        prediction: referenceType,
        confidence: Math.round(9 * weight),
        name: `Cầu Gấp ${gapSize + 1} (mỗi ${gapSize + 1} phiên)`,
        patternId: 'cau_gap'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauZiczac(results, type) {
  if (results.length < 8) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_ziczac');
  
  let zigzagCount = 0;
  for (let i = 0; i < results.length - 2; i++) {
    if (results[i] !== results[i + 1] && results[i + 1] !== results[i + 2] && results[i] === results[i + 2]) {
      zigzagCount++;
    } else {
      break;
    }
  }
  
  if (zigzagCount >= 3) {
    return { 
      detected: true, 
      zigzagCount,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(13, zigzagCount * 2 + 5) * weight),
      name: `Cầu Ziczac (${zigzagCount} lần)`,
      patternId: 'cau_ziczac'
    };
  }
  
  return { detected: false };
}

function analyzeCauDoi(results, type) {
  if (results.length < 4) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_doi');
  
  let pairChanges = 0;
  let i = 0;
  
  while (i < results.length - 1) {
    if (results[i] === results[i + 1]) {
      pairChanges++;
      i += 2;
    } else {
      break;
    }
  }
  
  if (pairChanges >= 2) {
    const isAlternatingPairs = results[0] !== results[2];
    if (isAlternatingPairs) {
      return { 
        detected: true, 
        pairChanges,
        prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(12, pairChanges * 3 + 4) * weight),
        name: `Cầu Đôi Đảo (${pairChanges} cặp)`,
        patternId: 'cau_doi'
      };
    } else {
      return { 
        detected: true, 
        pairChanges,
        prediction: results[0],
        confidence: Math.round(Math.min(11, pairChanges * 2 + 5) * weight),
        name: `Cầu Đôi Bệt (${pairChanges} cặp)`,
        patternId: 'cau_doi'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_rong');
  
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 6) {
    return { 
      detected: true, 
      streakLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(16, streakLength + 8) * weight),
      name: `Cầu Rồng ${streakLength} phiên (Bẻ mạnh)`,
      patternId: 'cau_rong'
    };
  }
  
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'smart_bet');
  const last10 = results.slice(0, 10);
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  
  const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  
  if (trendChanging) {
    const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      trendChange: true,
      prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(13 * weight),
      name: `Đảo Xu Hướng (${taiLast5}T-${5-taiLast5}X → ${taiPrev5}T-${5-taiPrev5}X)`,
      patternId: 'smart_bet'
    };
  }
  
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      extreme: true,
      prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(12 * weight),
      name: `Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X trong 10 phiên)`,
      patternId: 'smart_bet'
    };
  }
  
  return { detected: false };
}

function analyzeDistribution(data, type, windowSize = 50) {
  const window = data.slice(0, windowSize);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  const xiuCount = window.length - taiCount;
  
  return {
    taiPercent: (taiCount / window.length) * 100,
    xiuPercent: (xiuCount / window.length) * 100,
    taiCount,
    xiuCount,
    total: window.length,
    imbalance: Math.abs(taiCount - xiuCount) / window.length
  };
}

function analyzeDicePatterns(data) {
  const recentData = data.slice(0, 15);
  
  let highDiceCount = 0;
  let lowDiceCount = 0;
  let totalSum = 0;
  let sumVariance = [];
  
  recentData.forEach(d => {
    const dices = [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3];
    dices.forEach(dice => {
      if (dice >= 4) highDiceCount++;
      else lowDiceCount++;
    });
    totalSum += d.Tong;
    sumVariance.push(d.Tong);
  });
  
  const avgSum = totalSum / recentData.length;
  const variance = sumVariance.reduce((acc, val) => acc + Math.pow(val - avgSum, 2), 0) / sumVariance.length;
  const stdDev = Math.sqrt(variance);
  
  return {
    highDiceRatio: highDiceCount / (highDiceCount + lowDiceCount),
    lowDiceRatio: lowDiceCount / (highDiceCount + lowDiceCount),
    averageSum: avgSum,
    standardDeviation: stdDev,
    sumTrend: avgSum > 10.5 ? 'high' : 'low',
    isStable: stdDev < 3
  };
}

function analyzeSumTrend(data) {
  const recentSums = data.slice(0, 20).map(d => d.Tong);
  
  let increasingCount = 0;
  let decreasingCount = 0;
  
  for (let i = 0; i < recentSums.length - 1; i++) {
    if (recentSums[i] > recentSums[i + 1]) decreasingCount++;
    else if (recentSums[i] < recentSums[i + 1]) increasingCount++;
  }
  
  const movingAvg5 = recentSums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const movingAvg10 = recentSums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  
  return {
    trend: increasingCount > decreasingCount ? 'increasing' : 'decreasing',
    strength: Math.abs(increasingCount - decreasingCount) / (recentSums.length - 1),
    movingAvg5,
    movingAvg10,
    shortTermBias: movingAvg5 > 10.5 ? 'Tài' : 'Xỉu'
  };
}

function analyzeRecentMomentum(results) {
  const windows = [3, 5, 10, 15];
  const momentum = {};
  
  windows.forEach(size => {
    if (results.length >= size) {
      const window = results.slice(0, size);
      const taiCount = window.filter(r => r === 'Tài').length;
      momentum[`window_${size}`] = {
        taiRatio: taiCount / size,
        xiuRatio: (size - taiCount) / size,
        dominant: taiCount > size / 2 ? 'Tài' : 'Xỉu'
      };
    }
  });
  
  return momentum;
}

function detectCyclePattern(results, type) {
  if (results.length < 12) return { detected: false };
  
  for (let cycleLength = 2; cycleLength <= 6; cycleLength++) {
    let isRepeating = true;
    const pattern = results.slice(0, cycleLength);
    
    for (let i = cycleLength; i < Math.min(cycleLength * 3, results.length); i++) {
      if (results[i] !== pattern[i % cycleLength]) {
        isRepeating = false;
        break;
      }
    }
    
    if (isRepeating) {
      const nextPosition = results.length % cycleLength;
      const weight = getPatternWeight(type, 'cau_chu_ky');
      return { 
        detected: true, 
        cycleLength,
        pattern,
        prediction: pattern[nextPosition],
        confidence: Math.round(9 * weight),
        name: `Cầu Chu Kỳ ${cycleLength}`,
        patternId: 'cau_chu_ky'
      };
    }
  }
  
  return { detected: false };
}

function analyzeEdgeCases(data, type) {
  if (data.length < 10) return { detected: false };
  
  const recentTotals = data.slice(0, 10).map(d => d.Tong);
  
  const extremeHighCount = recentTotals.filter(t => t >= 14).length;
  const extremeLowCount = recentTotals.filter(t => t <= 7).length;
  const weight = getPatternWeight(type, 'edge_cases');
  
  if (extremeHighCount >= 4) {
    return { 
      detected: true, 
      type: 'extreme_high',
      prediction: 'Xỉu',
      confidence: Math.round(7 * weight),
      name: `Cực Điểm Cao (${extremeHighCount} phiên >= 14)`,
      patternId: 'edge_cases'
    };
  }
  
  if (extremeLowCount >= 4) {
    return { 
      detected: true, 
      type: 'extreme_low',
      prediction: 'Tài',
      confidence: Math.round(7 * weight),
      name: `Cực Điểm Thấp (${extremeLowCount} phiên <= 7)`,
      patternId: 'edge_cases'
    };
  }
  
  return { detected: false };
}

function analyzeDiceTrendLineHu(data, type) {
  if (data.length < 3) return { detected: false };
  
  const current = data[0];
  const previous = data[1];
  
  const currentDices = [current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3];
  const previousDices = [previous.Xuc_xac_1, previous.Xuc_xac_2, previous.Xuc_xac_3];
  
  const directions = [];
  for (let i = 0; i < 3; i++) {
    if (currentDices[i] > previousDices[i]) {
      directions.push('up');
    } else if (currentDices[i] < previousDices[i]) {
      directions.push('down');
    } else {
      directions.push('same');
    }
  }
  
  const upCount = directions.filter(d => d === 'up').length;
  const downCount = directions.filter(d => d === 'down').length;
  const sameCount = directions.filter(d => d === 'same').length;
  
  const previousResult = previous.Ket_qua;
  const weight = getPatternWeight(type, 'dice_trend_line');
  
  const allSameDice = currentDices[0] === currentDices[1] && currentDices[1] === currentDices[2];
  if (allSameDice) {
    const prediction = currentDices[0] >= 4 ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'same_dice',
      prediction,
      confidence: Math.round(13 * weight),
      name: `Biểu Đồ Đường (3 xúc xắc giống ${currentDices[0]})`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  const twoSameDice = (currentDices[0] === currentDices[1]) || 
                       (currentDices[1] === currentDices[2]) || 
                       (currentDices[0] === currentDices[2]);
  if (twoSameDice) {
    const prediction = previousResult === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'two_same_dice',
      prediction,
      confidence: Math.round(11 * weight),
      name: `Biểu Đồ Đường (2 xúc xắc giống - Bẻ ${previousResult})`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  const maxDice = Math.max(...currentDices);
  const minDice = Math.min(...currentDices);
  if (maxDice === 6 && minDice === 1) {
    const prediction = previousResult === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'extreme_range',
      prediction,
      confidence: Math.round(12 * weight),
      name: `Biểu Đồ Đường (Biên độ max 6-1 - Bẻ)`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, maxDice, minDice, directions }
    };
  }
  
  if (upCount === 1 && downCount === 2) {
    return {
      detected: true,
      type: 'trend_1up_2down',
      prediction: 'Tài',
      confidence: Math.round(12 * weight),
      name: `Biểu Đồ Đường (1 lên 2 xuống → Tài)`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  if (upCount === 2 && downCount === 1) {
    return {
      detected: true,
      type: 'trend_2up_1down',
      prediction: 'Xỉu',
      confidence: Math.round(12 * weight),
      name: `Biểu Đồ Đường (2 lên 1 xuống → Xỉu)`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  if (upCount === 3 || downCount === 3) {
    const prediction = previousResult;
    return {
      detected: true,
      type: 'all_same_direction',
      prediction,
      confidence: Math.round(10 * weight),
      name: `Biểu Đồ Đường (3 dây cùng ${upCount === 3 ? 'lên' : 'xuống'} → Theo ${previousResult})`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  const twoSameDirection = (upCount === 2 && sameCount === 1) || 
                           (downCount === 2 && sameCount === 1) ||
                           (sameCount === 2 && (upCount === 1 || downCount === 1));
  if (twoSameDirection) {
    const prediction = previousResult === 'Tài' ? 'Xỉu' : 'Tài';
    const directionDesc = sameCount === 2 ? '2 dây ngang' : 
                         (upCount === 2 ? '2 dây lên' : '2 dây xuống');
    return {
      detected: true,
      type: 'two_same_direction',
      prediction,
      confidence: Math.round(10 * weight),
      name: `Biểu Đồ Đường (${directionDesc} → Bẻ ${previousResult})`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  return { detected: false };
}

function analyzeDiceTrendLineMd5(data, type) {
  if (data.length < 3) return { detected: false };
  
  const current = data[0];
  const previous = data[1];
  const beforePrevious = data[2];
  
  const currentDices = [current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3];
  const previousDices = [previous.Xuc_xac_1, previous.Xuc_xac_2, previous.Xuc_xac_3];
  const beforePrevDices = [beforePrevious.Xuc_xac_1, beforePrevious.Xuc_xac_2, beforePrevious.Xuc_xac_3];
  
  const directions = [];
  for (let i = 0; i < 3; i++) {
    if (currentDices[i] > previousDices[i]) {
      directions.push('up');
    } else if (currentDices[i] < previousDices[i]) {
      directions.push('down');
    } else {
      directions.push('same');
    }
  }
  
  const upCount = directions.filter(d => d === 'up').length;
  const downCount = directions.filter(d => d === 'down').length;
  const sameCount = directions.filter(d => d === 'same').length;
  
  const previousResult = previous.Ket_qua;
  const weight = getPatternWeight(type, 'dice_trend_line_md5');
  
  const sortedDices = [...currentDices].sort((a, b) => b - a);
  if (sortedDices[0] === sortedDices[1] && sortedDices[0] >= 5) {
    const prediction = 'Xỉu';
    return {
      detected: true,
      type: 'double_high',
      prediction,
      confidence: Math.round(13 * weight),
      name: `MD5 Biểu Đồ (2 xúc xắc cao ${sortedDices[0]}-${sortedDices[1]} → Xỉu)`,
      patternId: 'dice_trend_line_md5',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  if (sortedDices[1] === sortedDices[2] && sortedDices[1] <= 2) {
    const prediction = 'Tài';
    return {
      detected: true,
      type: 'double_low',
      prediction,
      confidence: Math.round(13 * weight),
      name: `MD5 Biểu Đồ (2 xúc xắc thấp ${sortedDices[1]}-${sortedDices[2]} → Tài)`,
      patternId: 'dice_trend_line_md5',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  const sumCurrent = currentDices.reduce((a, b) => a + b, 0);
  const sumPrevious = previousDices.reduce((a, b) => a + b, 0);
  const sumBeforePrev = beforePrevDices.reduce((a, b) => a + b, 0);
  
  const sumTrendUp = sumCurrent > sumPrevious && sumPrevious > sumBeforePrev;
  const sumTrendDown = sumCurrent < sumPrevious && sumPrevious < sumBeforePrev;
  
  if (sumTrendUp || sumTrendDown) {
    const prediction = sumTrendUp ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'sum_trend_break',
      prediction,
      confidence: Math.round(12 * weight),
      name: `MD5 Biểu Đồ (Tổng ${sumTrendUp ? 'tăng' : 'giảm'} liên tục → Bẻ)`,
      patternId: 'dice_trend_line_md5',
      analysis: { sumCurrent, sumPrevious, sumBeforePrev, directions }
    };
  }
  
  if (upCount === 1 && downCount === 2) {
    return {
      detected: true,
      type: 'trend_1up_2down',
      prediction: 'Tài',
      confidence: Math.round(11 * weight),
      name: `MD5 Biểu Đồ (1 lên 2 xuống → Tài)`,
      patternId: 'dice_trend_line_md5',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  if (upCount === 2 && downCount === 1) {
    return {
      detected: true,
      type: 'trend_2up_1down',
      prediction: 'Xỉu',
      confidence: Math.round(11 * weight),
      name: `MD5 Biểu Đồ (2 lên 1 xuống → Xỉu)`,
      patternId: 'dice_trend_line_md5',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  if (upCount === 3 || downCount === 3) {
    const prediction = previousResult;
    return {
      detected: true,
      type: 'all_same_direction',
      prediction,
      confidence: Math.round(9 * weight),
      name: `MD5 Biểu Đồ (3 dây cùng ${upCount === 3 ? 'lên' : 'xuống'} → Theo ${previousResult})`,
      patternId: 'dice_trend_line_md5',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  const twoSameDirection = (upCount === 2 && sameCount === 1) || 
                           (downCount === 2 && sameCount === 1) ||
                           (sameCount === 2 && (upCount === 1 || downCount === 1));
  if (twoSameDirection) {
    const prediction = previousResult === 'Tài' ? 'Xỉu' : 'Tài';
    const directionDesc = sameCount === 2 ? '2 dây ngang' : 
                         (upCount === 2 ? '2 dây lên' : '2 dây xuống');
    return {
      detected: true,
      type: 'two_same_direction',
      prediction,
      confidence: Math.round(9 * weight),
      name: `MD5 Biểu Đồ (${directionDesc} → Bẻ ${previousResult})`,
      patternId: 'dice_trend_line_md5',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  return { detected: false };
}

function analyzeDayGayHu(data, type) {
  if (data.length < 3) return { detected: false };
  
  const current = data[0];
  const previous = data[1];
  
  const currentDices = [current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3];
  const previousDices = [previous.Xuc_xac_1, previous.Xuc_xac_2, previous.Xuc_xac_3];
  
  const directions = [];
  for (let i = 0; i < 3; i++) {
    if (currentDices[i] > previousDices[i]) {
      directions.push('up');
    } else if (currentDices[i] < previousDices[i]) {
      directions.push('down');
    } else {
      directions.push('same');
    }
  }
  
  const upCount = directions.filter(d => d === 'up').length;
  const downCount = directions.filter(d => d === 'down').length;
  const sameCount = directions.filter(d => d === 'same').length;
  
  const weight = getPatternWeight(type, 'day_gay');
  
  if (sameCount === 2 && upCount === 1) {
    const sameIndices = directions.map((d, i) => d === 'same' ? i : -1).filter(i => i !== -1);
    const sameDiceValues = sameIndices.map(i => currentDices[i]);
    
    if (sameDiceValues[0] === sameDiceValues[1]) {
      const sameValueDesc = `${sameDiceValues[0]}-${sameDiceValues[1]}`;
      
      return {
        detected: true,
        type: 'day_gay_2thang_1len',
        prediction: 'Xỉu',
        confidence: Math.round(14 * weight),
        name: `Dây Gãy (2 dây thẳng ${sameValueDesc} + 1 lên → Xỉu)`,
        patternId: 'day_gay',
        analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions, sameDiceValues }
      };
    }
  }
  
  if (sameCount === 2 && downCount === 1) {
    const sameIndices = directions.map((d, i) => d === 'same' ? i : -1).filter(i => i !== -1);
    const sameDiceValues = sameIndices.map(i => currentDices[i]);
    
    if (sameDiceValues[0] === sameDiceValues[1]) {
      const sameValueDesc = `${sameDiceValues[0]}-${sameDiceValues[1]}`;
      
      return {
        detected: true,
        type: 'day_gay_2thang_1xuong',
        prediction: 'Tài',
        confidence: Math.round(14 * weight),
        name: `Dây Gãy (2 dây thẳng ${sameValueDesc} + 1 xuống → Tài)`,
        patternId: 'day_gay',
        analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions, sameDiceValues }
      };
    }
  }
  
  return { detected: false };
}

function analyzeDayGayMd5(data, type) {
  if (data.length < 3) return { detected: false };
  
  const current = data[0];
  const previous = data[1];
  
  const currentDices = [current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3];
  const previousDices = [previous.Xuc_xac_1, previous.Xuc_xac_2, previous.Xuc_xac_3];
  
  const directions = [];
  for (let i = 0; i < 3; i++) {
    if (currentDices[i] > previousDices[i]) {
      directions.push('up');
    } else if (currentDices[i] < previousDices[i]) {
      directions.push('down');
    } else {
      directions.push('same');
    }
  }
  
  const upCount = directions.filter(d => d === 'up').length;
  const downCount = directions.filter(d => d === 'down').length;
  const sameCount = directions.filter(d => d === 'same').length;
  
  const weight = getPatternWeight(type, 'day_gay_md5');
  
  if (sameCount === 2 && upCount === 1) {
    const sameIndices = directions.map((d, i) => d === 'same' ? i : -1).filter(i => i !== -1);
    const sameDiceValues = sameIndices.map(i => currentDices[i]);
    
    if (sameDiceValues[0] === sameDiceValues[1]) {
      const sameValueDesc = `${sameDiceValues[0]}-${sameDiceValues[1]}`;
      
      return {
        detected: true,
        type: 'day_gay_2thang_1len',
        prediction: 'Xỉu',
        confidence: Math.round(14 * weight),
        name: `MD5 Dây Gãy (2 dây thẳng ${sameValueDesc} + 1 lên → Xỉu)`,
        patternId: 'day_gay_md5',
        analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions, sameDiceValues }
      };
    }
  }
  
  if (sameCount === 2 && downCount === 1) {
    const sameIndices = directions.map((d, i) => d === 'same' ? i : -1).filter(i => i !== -1);
    const sameDiceValues = sameIndices.map(i => currentDices[i]);
    
    if (sameDiceValues[0] === sameDiceValues[1]) {
      const sameValueDesc = `${sameDiceValues[0]}-${sameDiceValues[1]}`;
      
      return {
        detected: true,
        type: 'day_gay_2thang_1xuong',
        prediction: 'Tài',
        confidence: Math.round(14 * weight),
        name: `MD5 Dây Gãy (2 dây thẳng ${sameValueDesc} + 1 xuống → Tài)`,
        patternId: 'day_gay_md5',
        analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions, sameDiceValues }
      };
    }
  }
  
  return { detected: false };
}

function analyzeBreakPatternHu(results, data, type) {
  if (results.length < 4) return { detected: false };
  
  const weight = getPatternWeight(type, 'break_pattern_hu');
  
  const is1212 = results[0] !== results[1] && 
                  results[1] !== results[2] && 
                  results[2] !== results[3] &&
                  results[0] === results[2] &&
                  results[1] === results[3];
  
  if (is1212) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'pattern_1212',
      prediction,
      confidence: Math.round(14 * weight),
      name: `Cầu Liên Tục 1-2-1-2 (Bẻ → ${prediction})`,
      patternId: 'break_pattern_hu'
    };
  }
  
  const allSame = results.slice(0, 4).every(r => r === results[0]);
  if (allSame) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'pattern_1111',
      prediction,
      confidence: Math.round(13 * weight),
      name: `Cầu Liên Tục 1-1-1-1 (Bẻ → ${prediction})`,
      patternId: 'break_pattern_hu'
    };
  }
  
  return { detected: false };
}

function analyzeBreakPatternMd5(results, data, type) {
  if (results.length < 4) return { detected: false };
  
  const weight = getPatternWeight(type, 'break_pattern_md5');
  
  const is1212 = results[0] !== results[1] && 
                  results[1] !== results[2] && 
                  results[2] !== results[3] &&
                  results[0] === results[2] &&
                  results[1] === results[3];
  
  if (is1212) {
    const prediction = results[0];
    return {
      detected: true,
      type: 'pattern_1212',
      prediction,
      confidence: Math.round(13 * weight),
      name: `MD5 Cầu 1-2-1-2 (Theo → ${prediction})`,
      patternId: 'break_pattern_md5'
    };
  }
  
  const allSame = results.slice(0, 4).every(r => r === results[0]);
  if (allSame) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'pattern_1111',
      prediction,
      confidence: Math.round(14 * weight),
      name: `MD5 Cầu 1-1-1-1 (Bẻ → ${prediction})`,
      patternId: 'break_pattern_md5'
    };
  }
  
  return { detected: false };
}

function analyzeFibonacciPattern(data, type) {
  if (data.length < 13) return { detected: false };
  
  const weight = getPatternWeight(type, 'fibonacci');
  const fibSequence = [1, 1, 2, 3, 5, 8, 13];
  const results = data.slice(0, 13).map(d => d.Ket_qua);
  
  let fibTaiCount = 0;
  let fibXiuCount = 0;
  
  fibSequence.forEach(pos => {
    if (pos <= results.length) {
      if (results[pos - 1] === 'Tài') fibTaiCount++;
      else fibXiuCount++;
    }
  });
  
  if (Math.abs(fibTaiCount - fibXiuCount) >= 4) {
    const dominant = fibTaiCount > fibXiuCount ? 'Tài' : 'Xỉu';
    const prediction = dominant === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'fibonacci_reversal',
      prediction,
      confidence: Math.round(11 * weight),
      name: `Fibonacci (${fibTaiCount}T-${fibXiuCount}X → Bẻ ${prediction})`,
      patternId: 'fibonacci',
      analysis: { fibTaiCount, fibXiuCount, positions: fibSequence }
    };
  }
  
  if (fibTaiCount === fibXiuCount) {
    const prediction = results[0];
    return {
      detected: true,
      type: 'fibonacci_balance',
      prediction,
      confidence: Math.round(9 * weight),
      name: `Fibonacci Cân Bằng (Theo ${prediction})`,
      patternId: 'fibonacci',
      analysis: { fibTaiCount, fibXiuCount }
    };
  }
  
  return { detected: false };
}

function analyzeMomentumPattern(data, type) {
  if (data.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'momentum');
  const sums = data.slice(0, 10).map(d => d.Xuc_xac_1 + d.Xuc_xac_2 + d.Xuc_xac_3);
  
  let momentum = 0;
  for (let i = 0; i < sums.length - 1; i++) {
    momentum += (sums[i] - sums[i + 1]);
  }
  
  const avgMomentum = momentum / (sums.length - 1);
  
  if (Math.abs(avgMomentum) > 2) {
    const prediction = avgMomentum > 0 ? 'Tài' : 'Xỉu';
    const strength = Math.abs(avgMomentum) > 3 ? 'mạnh' : 'vừa';
    return {
      detected: true,
      type: 'momentum_trend',
      prediction,
      confidence: Math.round((10 + Math.min(Math.abs(avgMomentum), 5)) * weight),
      name: `Momentum ${strength} (${avgMomentum.toFixed(1)} → ${prediction})`,
      patternId: 'momentum',
      analysis: { avgMomentum, sums: sums.slice(0, 5) }
    };
  }
  
  const velocityChange = (sums[0] - sums[1]) - (sums[1] - sums[2]);
  if (Math.abs(velocityChange) > 4) {
    const prediction = velocityChange > 0 ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'momentum_reversal',
      prediction,
      confidence: Math.round(12 * weight),
      name: `Momentum Đảo Chiều (${velocityChange > 0 ? '+' : ''}${velocityChange} → ${prediction})`,
      patternId: 'momentum',
      analysis: { velocityChange, recentSums: sums.slice(0, 3) }
    };
  }
  
  return { detected: false };
}

function analyzeResistanceSupport(data, type) {
  if (data.length < 20) return { detected: false };
  
  const weight = getPatternWeight(type, 'resistance_support');
  const sums = data.slice(0, 20).map(d => d.Xuc_xac_1 + d.Xuc_xac_2 + d.Xuc_xac_3);
  
  const currentSum = sums[0];
  const maxSum = Math.max(...sums);
  const minSum = Math.min(...sums);
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  
  const resistance = maxSum - 1;
  const support = minSum + 1;
  
  if (currentSum >= resistance) {
    return {
      detected: true,
      type: 'resistance_hit',
      prediction: 'Xỉu',
      confidence: Math.round(13 * weight),
      name: `Kháng Cự (Tổng ${currentSum} ≥ ${resistance} → Xỉu)`,
      patternId: 'resistance_support',
      analysis: { currentSum, resistance, maxSum }
    };
  }
  
  if (currentSum <= support) {
    return {
      detected: true,
      type: 'support_hit',
      prediction: 'Tài',
      confidence: Math.round(13 * weight),
      name: `Hỗ Trợ (Tổng ${currentSum} ≤ ${support} → Tài)`,
      patternId: 'resistance_support',
      analysis: { currentSum, support, minSum }
    };
  }
  
  const distToResistance = resistance - currentSum;
  const distToSupport = currentSum - support;
  
  if (distToResistance <= 2 && distToResistance < distToSupport) {
    return {
      detected: true,
      type: 'near_resistance',
      prediction: 'Xỉu',
      confidence: Math.round(10 * weight),
      name: `Gần Kháng Cự (${currentSum} → ${resistance})`,
      patternId: 'resistance_support',
      analysis: { currentSum, resistance, distToResistance }
    };
  }
  
  if (distToSupport <= 2 && distToSupport < distToResistance) {
    return {
      detected: true,
      type: 'near_support',
      prediction: 'Tài',
      confidence: Math.round(10 * weight),
      name: `Gần Hỗ Trợ (${currentSum} → ${support})`,
      patternId: 'resistance_support',
      analysis: { currentSum, support, distToSupport }
    };
  }
  
  return { detected: false };
}

function analyzeWavePattern(data, type) {
  if (data.length < 12) return { detected: false };
  
  const weight = getPatternWeight(type, 'wave');
  const results = data.slice(0, 12).map(d => d.Ket_qua);
  
  let waves = [];
  let currentWave = { type: results[0], count: 1 };
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === currentWave.type) {
      currentWave.count++;
    } else {
      waves.push(currentWave);
      currentWave = { type: results[i], count: 1 };
    }
  }
  waves.push(currentWave);
  
  if (waves.length >= 4) {
    const waveLengths = waves.slice(0, 4).map(w => w.count);
    const isIncreasing = waveLengths.every((v, i, a) => i === 0 || v >= a[i - 1]);
    const isDecreasing = waveLengths.every((v, i, a) => i === 0 || v <= a[i - 1]);
    
    if (isIncreasing && waveLengths[0] < waveLengths[3]) {
      const prediction = waves[0].type === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        type: 'wave_expanding',
        prediction,
        confidence: Math.round(12 * weight),
        name: `Sóng Mở Rộng (${waveLengths.join('-')} → Bẻ ${prediction})`,
        patternId: 'wave',
        analysis: { waveLengths, pattern: 'expanding' }
      };
    }
    
    if (isDecreasing && waveLengths[0] > waveLengths[3]) {
      const prediction = waves[0].type;
      return {
        detected: true,
        type: 'wave_contracting',
        prediction,
        confidence: Math.round(11 * weight),
        name: `Sóng Thu Hẹp (${waveLengths.join('-')} → Theo ${prediction})`,
        patternId: 'wave',
        analysis: { waveLengths, pattern: 'contracting' }
      };
    }
  }
  
  if (waves.length >= 3) {
    const lastThreeWaves = waves.slice(0, 3);
    const avgWaveLength = lastThreeWaves.reduce((a, w) => a + w.count, 0) / 3;
    
    if (waves[0].count > avgWaveLength * 1.5) {
      const prediction = waves[0].type === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        type: 'wave_peak',
        prediction,
        confidence: Math.round(11 * weight),
        name: `Đỉnh Sóng (${waves[0].count} > avg ${avgWaveLength.toFixed(1)} → Bẻ)`,
        patternId: 'wave',
        analysis: { currentWaveLength: waves[0].count, avgWaveLength }
      };
    }
  }
  
  return { detected: false };
}

function analyzeGoldenRatio(data, type) {
  if (data.length < 21) return { detected: false };
  
  const weight = getPatternWeight(type, 'golden_ratio');
  const results = data.slice(0, 21);
  
  const goldenPositions = [1, 2, 3, 5, 8, 13, 21];
  let taiAtGolden = 0;
  let xiuAtGolden = 0;
  
  goldenPositions.forEach(pos => {
    if (pos <= results.length) {
      const result = results[pos - 1].Ket_qua;
      if (result === 'Tài') taiAtGolden++;
      else xiuAtGolden++;
    }
  });
  
  const ratio = Math.max(taiAtGolden, xiuAtGolden) / Math.min(taiAtGolden, xiuAtGolden);
  
  if (ratio >= 1.6 && ratio <= 1.7) {
    const dominant = taiAtGolden > xiuAtGolden ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      type: 'golden_ratio_detected',
      prediction: dominant,
      confidence: Math.round(12 * weight),
      name: `Tỷ Lệ Vàng (${taiAtGolden}T:${xiuAtGolden}X = ${ratio.toFixed(2)} → ${dominant})`,
      patternId: 'golden_ratio',
      analysis: { taiAtGolden, xiuAtGolden, ratio, goldenPositions }
    };
  }
  
  if (taiAtGolden >= 5 || xiuAtGolden >= 5) {
    const dominant = taiAtGolden > xiuAtGolden ? 'Tài' : 'Xỉu';
    const prediction = dominant === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'golden_extreme',
      prediction,
      confidence: Math.round(11 * weight),
      name: `Fibonacci Cực (${Math.max(taiAtGolden, xiuAtGolden)}/7 → Bẻ ${prediction})`,
      patternId: 'golden_ratio',
      analysis: { taiAtGolden, xiuAtGolden }
    };
  }
  
  return { detected: false };
}

function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  const cauBet = analyzeCauBet(results, type);
  if (cauBet.detected) {
    predictions.push({ prediction: cauBet.prediction, confidence: cauBet.confidence, priority: 10, name: cauBet.name });
    factors.push(cauBet.name);
    allPatterns.push(cauBet);
  }
  
  const cauDao11 = analyzeCauDao11(results, type);
  if (cauDao11.detected) {
    predictions.push({ prediction: cauDao11.prediction, confidence: cauDao11.confidence, priority: 9, name: cauDao11.name });
    factors.push(cauDao11.name);
    allPatterns.push(cauDao11);
  }
  
  const cau22 = analyzeCau22(results, type);
  if (cau22.detected) {
    predictions.push({ prediction: cau22.prediction, confidence: cau22.confidence, priority: 8, name: cau22.name });
    factors.push(cau22.name);
    allPatterns.push(cau22);
  }
  
  const cau33 = analyzeCau33(results, type);
  if (cau33.detected) {
    predictions.push({ prediction: cau33.prediction, confidence: cau33.confidence, priority: 8, name: cau33.name });
    factors.push(cau33.name);
    allPatterns.push(cau33);
  }
  
  const cau121 = analyzeCau121(results, type);
  if (cau121.detected) {
    predictions.push({ prediction: cau121.prediction, confidence: cau121.confidence, priority: 7, name: cau121.name });
    factors.push(cau121.name);
    allPatterns.push(cau121);
  }
  
  const cau123 = analyzeCau123(results, type);
  if (cau123.detected) {
    predictions.push({ prediction: cau123.prediction, confidence: cau123.confidence, priority: 7, name: cau123.name });
    factors.push(cau123.name);
    allPatterns.push(cau123);
  }
  
  const cau321 = analyzeCau321(results, type);
  if (cau321.detected) {
    predictions.push({ prediction: cau321.prediction, confidence: cau321.confidence, priority: 7, name: cau321.name });
    factors.push(cau321.name);
    allPatterns.push(cau321);
  }
  
  const cauNhayCoc = analyzeCauNhayCoc(results, type);
  if (cauNhayCoc.detected) {
    predictions.push({ prediction: cauNhayCoc.prediction, confidence: cauNhayCoc.confidence, priority: 6, name: cauNhayCoc.name });
    factors.push(cauNhayCoc.name);
    allPatterns.push(cauNhayCoc);
  }
  
  const cauNhipNghieng = analyzeCauNhipNghieng(results, type);
  if (cauNhipNghieng.detected) {
    predictions.push({ prediction: cauNhipNghieng.prediction, confidence: cauNhipNghieng.confidence, priority: 7, name: cauNhipNghieng.name });
    factors.push(cauNhipNghieng.name);
    allPatterns.push(cauNhipNghieng);
  }
  
  const cau3Van1 = analyzeCau3Van1(results, type);
  if (cau3Van1.detected) {
    predictions.push({ prediction: cau3Van1.prediction, confidence: cau3Van1.confidence, priority: 6, name: cau3Van1.name });
    factors.push(cau3Van1.name);
    allPatterns.push(cau3Van1);
  }
  
  const cauBeCau = analyzeCauBeCau(results, type);
  if (cauBeCau.detected) {
    predictions.push({ prediction: cauBeCau.prediction, confidence: cauBeCau.confidence, priority: 8, name: cauBeCau.name });
    factors.push(cauBeCau.name);
    allPatterns.push(cauBeCau);
  }
  
  const cyclePattern = detectCyclePattern(results, type);
  if (cyclePattern.detected) {
    predictions.push({ prediction: cyclePattern.prediction, confidence: cyclePattern.confidence, priority: 7, name: cyclePattern.name });
    factors.push(cyclePattern.name);
    allPatterns.push(cyclePattern);
  }
  
  const cau44 = analyzeCau44(results, type);
  if (cau44.detected) {
    predictions.push({ prediction: cau44.prediction, confidence: cau44.confidence, priority: 9, name: cau44.name });
    factors.push(cau44.name);
    allPatterns.push(cau44);
  }
  
  const cau55 = analyzeCau55(results, type);
  if (cau55.detected) {
    predictions.push({ prediction: cau55.prediction, confidence: cau55.confidence, priority: 9, name: cau55.name });
    factors.push(cau55.name);
    allPatterns.push(cau55);
  }
  
  const cau212 = analyzeCau212(results, type);
  if (cau212.detected) {
    predictions.push({ prediction: cau212.prediction, confidence: cau212.confidence, priority: 8, name: cau212.name });
    factors.push(cau212.name);
    allPatterns.push(cau212);
  }
  
  const cau1221 = analyzeCau1221(results, type);
  if (cau1221.detected) {
    predictions.push({ prediction: cau1221.prediction, confidence: cau1221.confidence, priority: 8, name: cau1221.name });
    factors.push(cau1221.name);
    allPatterns.push(cau1221);
  }
  
  const cau2112 = analyzeCau2112(results, type);
  if (cau2112.detected) {
    predictions.push({ prediction: cau2112.prediction, confidence: cau2112.confidence, priority: 8, name: cau2112.name });
    factors.push(cau2112.name);
    allPatterns.push(cau2112);
  }
  
  const cauGap = analyzeCauGap(results, type);
  if (cauGap.detected) {
    predictions.push({ prediction: cauGap.prediction, confidence: cauGap.confidence, priority: 7, name: cauGap.name });
    factors.push(cauGap.name);
    allPatterns.push(cauGap);
  }
  
  const cauZiczac = analyzeCauZiczac(results, type);
  if (cauZiczac.detected) {
    predictions.push({ prediction: cauZiczac.prediction, confidence: cauZiczac.confidence, priority: 8, name: cauZiczac.name });
    factors.push(cauZiczac.name);
    allPatterns.push(cauZiczac);
  }
  
  const cauDoi = analyzeCauDoi(results, type);
  if (cauDoi.detected) {
    predictions.push({ prediction: cauDoi.prediction, confidence: cauDoi.confidence, priority: 8, name: cauDoi.name });
    factors.push(cauDoi.name);
    allPatterns.push(cauDoi);
  }
  
  const cauRong = analyzeCauRong(results, type);
  if (cauRong.detected) {
    predictions.push({ prediction: cauRong.prediction, confidence: cauRong.confidence, priority: 10, name: cauRong.name });
    factors.push(cauRong.name);
    allPatterns.push(cauRong);
  }
  
  const smartBet = analyzeSmartBet(results, type);
  if (smartBet.detected) {
    predictions.push({ prediction: smartBet.prediction, confidence: smartBet.confidence, priority: 9, name: smartBet.name });
    factors.push(smartBet.name);
    allPatterns.push(smartBet);
  }
  
  if (type === 'hu') {
    const diceTrendLineHu = analyzeDiceTrendLineHu(last50, type);
    if (diceTrendLineHu.detected) {
      predictions.push({ prediction: diceTrendLineHu.prediction, confidence: diceTrendLineHu.confidence, priority: 11, name: diceTrendLineHu.name });
      factors.push(diceTrendLineHu.name);
      allPatterns.push(diceTrendLineHu);
    }
    
    const breakPatternHu = analyzeBreakPatternHu(results, last50, type);
    if (breakPatternHu.detected) {
      predictions.push({ prediction: breakPatternHu.prediction, confidence: breakPatternHu.confidence, priority: 12, name: breakPatternHu.name });
      factors.push(breakPatternHu.name);
      allPatterns.push(breakPatternHu);
    }
    
    const dayGayHu = analyzeDayGayHu(last50, type);
    if (dayGayHu.detected) {
      predictions.push({ prediction: dayGayHu.prediction, confidence: dayGayHu.confidence, priority: 13, name: dayGayHu.name });
      factors.push(dayGayHu.name);
      allPatterns.push(dayGayHu);
    }
  }
  
  if (type === 'md5') {
    const diceTrendLineMd5 = analyzeDiceTrendLineMd5(last50, type);
    if (diceTrendLineMd5.detected) {
      predictions.push({ prediction: diceTrendLineMd5.prediction, confidence: diceTrendLineMd5.confidence, priority: 11, name: diceTrendLineMd5.name });
      factors.push(diceTrendLineMd5.name);
      allPatterns.push(diceTrendLineMd5);
    }
    
    const breakPatternMd5 = analyzeBreakPatternMd5(results, last50, type);
    if (breakPatternMd5.detected) {
      predictions.push({ prediction: breakPatternMd5.prediction, confidence: breakPatternMd5.confidence, priority: 12, name: breakPatternMd5.name });
      factors.push(breakPatternMd5.name);
      allPatterns.push(breakPatternMd5);
    }
    
    const dayGayMd5 = analyzeDayGayMd5(last50, type);
    if (dayGayMd5.detected) {
      predictions.push({ prediction: dayGayMd5.prediction, confidence: dayGayMd5.confidence, priority: 13, name: dayGayMd5.name });
      factors.push(dayGayMd5.name);
      allPatterns.push(dayGayMd5);
    }
  }
  
  const distribution = analyzeDistribution(last50, type);
  if (distribution.imbalance > 0.2) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    const weight = getPatternWeight(type, 'distribution');
    predictions.push({ prediction: minority, confidence: Math.round(6 * weight), priority: 5, name: 'Phân bố lệch' });
    factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  const dicePatterns = analyzeDicePatterns(last50);
  if (dicePatterns.averageSum > 11.5) {
    const weight = getPatternWeight(type, 'dice_pattern');
    predictions.push({ prediction: 'Xỉu', confidence: Math.round(5 * weight), priority: 4, name: 'Tổng TB cao' });
    factors.push(`Tổng TB cao (${dicePatterns.averageSum.toFixed(1)})`);
  } else if (dicePatterns.averageSum < 9.5) {
    const weight = getPatternWeight(type, 'dice_pattern');
    predictions.push({ prediction: 'Tài', confidence: Math.round(5 * weight), priority: 4, name: 'Tổng TB thấp' });
    factors.push(`Tổng TB thấp (${dicePatterns.averageSum.toFixed(1)})`);
  }
  
  const sumTrend = analyzeSumTrend(last50);
  if (sumTrend.strength > 0.4) {
    const trendPrediction = sumTrend.trend === 'increasing' ? 'Tài' : 'Xỉu';
    const weight = getPatternWeight(type, 'sum_trend');
    predictions.push({ prediction: trendPrediction, confidence: Math.round(4 * weight), priority: 3, name: 'Xu hướng tổng' });
    factors.push(`Xu hướng tổng ${sumTrend.trend === 'increasing' ? 'tăng' : 'giảm'}`);
  }
  
  const edgeCases = analyzeEdgeCases(last50, type);
  if (edgeCases.detected) {
    predictions.push({ prediction: edgeCases.prediction, confidence: edgeCases.confidence, priority: 5, name: edgeCases.name });
    factors.push(edgeCases.name);
    allPatterns.push(edgeCases);
  }
  
  const momentum = analyzeRecentMomentum(results);
  if (momentum.window_3 && momentum.window_10) {
    const shortTermDiff = Math.abs(momentum.window_3.taiRatio - momentum.window_10.taiRatio);
    if (shortTermDiff > 0.3) {
      const reversePrediction = momentum.window_3.dominant === 'Tài' ? 'Xỉu' : 'Tài';
      const weight = getPatternWeight(type, 'momentum');
      predictions.push({ prediction: reversePrediction, confidence: Math.round(5 * weight), priority: 4, name: 'Biến động ngắn hạn' });
      factors.push('Biến động ngắn hạn mạnh');
    }
  }
  
  const fibonacciPattern = analyzeFibonacciPattern(last50, type);
  if (fibonacciPattern.detected) {
    predictions.push({ prediction: fibonacciPattern.prediction, confidence: fibonacciPattern.confidence, priority: 8, name: fibonacciPattern.name });
    factors.push(fibonacciPattern.name);
    allPatterns.push(fibonacciPattern);
  }
  
  const momentumPattern = analyzeMomentumPattern(last50, type);
  if (momentumPattern.detected) {
    predictions.push({ prediction: momentumPattern.prediction, confidence: momentumPattern.confidence, priority: 9, name: momentumPattern.name });
    factors.push(momentumPattern.name);
    allPatterns.push(momentumPattern);
  }
  
  const resistanceSupport = analyzeResistanceSupport(last50, type);
  if (resistanceSupport.detected) {
    predictions.push({ prediction: resistanceSupport.prediction, confidence: resistanceSupport.confidence, priority: 10, name: resistanceSupport.name });
    factors.push(resistanceSupport.name);
    allPatterns.push(resistanceSupport);
  }
  
  const wavePattern = analyzeWavePattern(last50, type);
  if (wavePattern.detected) {
    predictions.push({ prediction: wavePattern.prediction, confidence: wavePattern.confidence, priority: 8, name: wavePattern.name });
    factors.push(wavePattern.name);
    allPatterns.push(wavePattern);
  }
  
  const goldenRatio = analyzeGoldenRatio(last50, type);
  if (goldenRatio.detected) {
    predictions.push({ prediction: goldenRatio.prediction, confidence: goldenRatio.confidence, priority: 9, name: goldenRatio.name });
    factors.push(goldenRatio.name);
    allPatterns.push(goldenRatio);
  }
  
  if (predictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
    predictions.push({ prediction: cauTuNhien.prediction, confidence: cauTuNhien.confidence, priority: 1, name: cauTuNhien.name });
    factors.push(cauTuNhien.name);
    allPatterns.push(cauTuNhien);
  }
  
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  const taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  const xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  let baseConfidence = 50;
  
  const topPredictions = predictions.slice(0, 3);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += p.confidence;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.round(agreementRatio * 10);
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  const randomAdjust = (Math.random() * 4) - 2;
  let finalConfidence = Math.round(baseConfidence + randomAdjust);
  
  finalConfidence = Math.max(50, Math.min(85, finalConfidence));
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPatterns,
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: taiVotes.length,
      xiuVotes: xiuVotes.length,
      taiScore,
      xiuScore,
      topPattern: predictions[0]?.name || 'N/A',
      distribution,
      dicePatterns,
      sumTrend,
      adaptiveBoost,
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0 
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak,
        bestStreak: learningData[type].streakAnalysis.bestStreak,
        worstStreak: learningData[type].streakAnalysis.worstStreak
      }
    }
  };
}

function savePredictionToHistory(type, phien, prediction, confidence) {
  const record = {
    phien: phien.toString(),
    du_doan: normalizeResult(prediction),
    ti_le: `${confidence}%`,
    id: '@mryanhdz',
    timestamp: new Date().toISOString()
  };
  
  predictionHistory[type].unshift(record);
  
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  
  return record;
}

app.get('/hu', async (req, res) => {
  try {
    const data = await fetchData();
    if (!data || !data.taixiu || data.taixiu.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('hu', data.taixiu);
    
    const taixiuData = data.taixiu;
    const latestItem = taixiuData[0]; // ADD THIS LINE
    const latestPhien = taixiuData[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(taixiuData, 'hu');
    
    savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    
    res.json({
      Phien: latestItem.Phien,
      Ket_qua: latestItem.Ket_qua,
      Xuc_xac_1: latestItem.Xuc_xac_1,
      Xuc_xac_2: latestItem.Xuc_xac_2,
      Xuc_xac_3: latestItem.Xuc_xac_3,
      Tong: latestItem.Tong,
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: '@tiendataox'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server', details: error.message });
  }
});

app.get('/md5', async (req, res) => {
  try {
    const data = await fetchData();
    if (!data || !data.taixiumd5 || data.taixiumd5.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('md5', data.taixiumd5);
    
    const md5Data = data.taixiumd5;
    const latestItem = md5Data[0]; // ADD THIS LINE
    const latestPhien = md5Data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(md5Data, 'md5');
    
    savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    
    res.json({
      Phien: latestItem.Phien,
      Ket_qua: latestItem.Ket_qua,
      Xuc_xac_1: latestItem.Xuc_xac_1,
      Xuc_xac_2: latestItem.Xuc_xac_2,
      Xuc_xac_3: latestItem.Xuc_xac_3,
      Tong: latestItem.Tong,
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: '@tiendataox'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server', details: error.message });
  }
});

app.get('/hu/lichsu', async (req, res) => {
  try {
    const data = await fetchData();
    if (data && data.taixiu) {
      await verifyPredictions('hu', data.taixiu);
    }
    
    const historyWithStatus = predictionHistory.hu.map(record => {
      const prediction = learningData.hu.predictions.find(p => p.phien === record.phien);
      
      let status = null;
      let ket_qua_thuc_te = null;
      
      if (prediction && prediction.verified) {
        status = prediction.isCorrect ? '✅' : '❌';
        ket_qua_thuc_te = prediction.actual;
      }
      
      return {
        ...record,
        ket_qua_thuc_te,
        status
      };
    });
    
    res.json({
      type: 'Tài Xỉu Hũ',
      history: historyWithStatus,
      total: historyWithStatus.length
    });
  } catch (error) {
    res.json({
      type: 'Tài Xỉu Hũ',
      history: predictionHistory.hu,
      total: predictionHistory.hu.length
    });
  }
});

app.get('/md5/lichsu', async (req, res) => {
  try {
    const data = await fetchData();
    if (data && data.taixiumd5) {
      await verifyPredictions('md5', data.taixiumd5);
    }
    
    const historyWithStatus = predictionHistory.md5.map(record => {
      const prediction = learningData.md5.predictions.find(p => p.phien === record.phien);
      
      let status = null;
      let ket_qua_thuc_te = null;
      
      if (prediction && prediction.verified) {
        status = prediction.isCorrect ? '✅' : '❌';
        ket_qua_thuc_te = prediction.actual;
      }
      
      return {
        ...record,
        ket_qua_thuc_te,
        status
      };
    });
    
    res.json({
      type: 'Tài Xỉu MD5',
      history: historyWithStatus,
      total: historyWithStatus.length
    });
  } catch (error) {
    res.json({
      type: 'Tài Xỉu MD5',
      history: predictionHistory.md5,
      total: predictionHistory.md5.length
    });
  }
});

app.get('/hu/analysis', async (req, res) => {
  try {
    const data = await fetchData();
    if (!data || !data.taixiu) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('hu', data.taixiu);
    
    const result = calculateAdvancedPrediction(data.taixiu, 'hu');
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      factors: result.factors,
      analysis: result.detailedAnalysis
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/md5/analysis', async (req, res) => {
  try {
    const data = await fetchData();
    if (!data || !data.taixiumd5) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('md5', data.taixiumd5);
    
    const result = calculateAdvancedPrediction(data.taixiumd5, 'md5');
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      factors: result.factors,
      analysis: result.detailedAnalysis
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/hu/learning', (req, res) => {
  const stats = learningData.hu;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  const recentAcc = stats.recentAccuracy.length > 0
    ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(2)
    : 0;
  
  res.json({
    type: 'Tài Xỉu Hũ - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    patternPerformance: Object.entries(stats.patternStats).map(([id, data]) => ({
      pattern: id,
      total: data.total,
      correct: data.correct,
      accuracy: data.total > 0 ? (data.correct / data.total * 100).toFixed(1) + '%' : 'N/A',
      weight: stats.patternWeights[id]?.toFixed(2) || '1.00',
      recentTrend: data.recentResults.length >= 5 
        ? (data.recentResults.slice(-5).reduce((a, b) => a + b, 0) / 5 * 100).toFixed(0) + '%'
        : 'N/A'
    })).filter(p => p.total > 0),
    lastUpdate: stats.lastUpdate
  });
});

app.get('/md5/learning', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  const recentAcc = stats.recentAccuracy.length > 0
    ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(2)
    : 0;
  
  res.json({
    type: 'Tài Xỉu MD5 - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    patternPerformance: Object.entries(stats.patternStats).map(([id, data]) => ({
      pattern: id,
      total: data.total,
      correct: data.correct,
      accuracy: data.total > 0 ? (data.correct / data.total * 100).toFixed(1) + '%' : 'N/A',
      weight: stats.patternWeights[id]?.toFixed(2) || '1.00',
      recentTrend: data.recentResults.length >= 5 
        ? (data.recentResults.slice(-5).reduce((a, b) => a + b, 0) / 5 * 100).toFixed(0) + '%'
        : 'N/A'
    })).filter(p => p.total > 0),
    lastUpdate: stats.lastUpdate
  });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: {
      predictions: [],
      patternStats: {},
      totalPredictions: 0,
      correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS },
      lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      adaptiveThresholds: {},
      recentAccuracy: []
    },
    md5: {
      predictions: [],
      patternStats: {},
      totalPredictions: 0,
      correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS },
      lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      adaptiveThresholds: {},
      recentAccuracy: []
    }
  };
  saveLearningData();
  res.json({ message: 'Learning data reset successfully' });
});

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log('Advanced Tai Xiu Prediction API v3.0 - Self-Learning Edition');
  console.log('');
  console.log('NEW FEATURES:');
  console.log('  - Self-learning from prediction results');
  console.log('  - Pattern weight adjustment based on accuracy');
  console.log('  - Streak analysis and smart reversal');
  console.log('  - Adaptive confidence based on recent performance');
  console.log('  - Persistent learning data storage');
  console.log('  - AUTO-SAVE: History saves automatically every 30s');
  console.log('');
  console.log('Supported Patterns:');
  console.log('  - Cầu Bệt, Đảo 1-1, 2-2, 3-3');
  console.log('  - Cầu 1-2-1, 1-2-3, 3-2-1');
  console.log('  - Cầu Nhảy Cóc, Nhịp Nghiêng');
  console.log('  - Cầu 3 Ván 1, Bẻ Cầu, Chu Kỳ');
  console.log('  - Biểu Đồ Đường (Hũ & MD5)');
  console.log('');
  console.log('Endpoints:');
  console.log('  / - Homepage');
  console.log('  /hu - Dự đoán Tài Xỉu Hũ');
  console.log('  /md5 - Dự đoán Tài Xỉu MD5');
  console.log('  /hu/lichsu - Lịch sử dự đoán Hũ');
  console.log('  /md5/lichsu - Lịch sử dự đoán MD5');
  console.log('  /hu/analysis - Phân tích chi tiết Hũ');
  console.log('  /md5/analysis - Phân tích chi tiết MD5');
  console.log('  /hu/learning - Thống kê học tập Hũ');
  console.log('  /md5/learning - Thống kê học tập MD5');
  console.log('  /reset-learning - Reset dữ liệu học');
  
  startAutoSaveTask();
});