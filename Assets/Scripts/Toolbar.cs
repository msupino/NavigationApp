using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

namespace Tools
{

    public class ActionEvent : UnityEvent<ToolType>
    {
    }

    public enum ToolType
    {
        None,
        Draw,
        Erase,
        Reverse,
        NewScene,
        SaveScene,
        LoadScene
    }

    public enum ButtonType
    {
        Tool,
        Action
    }

    public class Toolbar : MonoBehaviour
    {
        public ToolType currentTool;
        public GameObject stopBanner;
        public List<GameObject> buttons = new List<GameObject>();
        public UnityEvent eventDrawing = new UnityEvent();
        public UnityEvent eventStopDrawing = new UnityEvent();
        public UnityEvent eventErase = new UnityEvent();
        public UnityEvent eventStopErase = new UnityEvent();
        public ActionEvent eventActionTriggered = new ActionEvent();

        public Toolbar()
        {

        }

        private void Start()
        {
            stopBanner.SetActive(false);
        }


        public void StopAll()
        {

            foreach (GameObject btn in buttons)
            {
                btn.GetComponent<Tool>().Stop();     
            }
            SetTool(ToolType.None);
        }

        public void SetTool(ToolType t)
        {
            currentTool = t;
            switch (t)
            {
                case ToolType.None:
                    stopBanner.SetActive(false);
                    break;
                case ToolType.Draw:
                    stopBanner.SetActive(true);
                    break;
                case ToolType.Erase:
                    stopBanner.SetActive(true);
                    break;
            }

        }
    }

}