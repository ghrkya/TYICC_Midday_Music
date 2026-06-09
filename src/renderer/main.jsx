/**
 * TYICC午间悦听 - 渲染进程入口
 * 
 * 负责React应用的挂载和启动
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)