import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import './components/dbh-app'

const root = document.getElementById('root')
if (root) {
  const app = document.createElement('dbh-app')
  root.appendChild(app)
}
