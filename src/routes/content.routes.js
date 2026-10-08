import { Router } from 'express'
import { experts } from '../data/experts.js'
import { communityVoices, communityGroups, testimonials } from '../data/community.js'

const router = Router()
router.get('/experts', (_req, res) => res.json({ experts }))
router.get('/community', (_req, res) => res.json({ voices: communityVoices, groups: communityGroups, testimonials }))
export default router
