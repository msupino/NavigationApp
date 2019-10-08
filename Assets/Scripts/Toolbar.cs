using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

namespace Tools
{

    public enum Tooltype
    {
        None,
        Draw,
        Erase
    }

    public class Toolbar : MonoBehaviour
    {
        public Tooltype currentTool;
        public GameObject stopBanner;
        public List<GameObject> buttons = new List<GameObject>();
        public UnityEvent eventDrawing = new UnityEvent();
        public UnityEvent eventStopDrawing = new UnityEvent();
        public UnityEvent eventErase = new UnityEvent();
        public UnityEvent eventStopErase = new UnityEvent();

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
            SetTool(Tooltype.None);
        }

        public void SetTool(Tooltype t)
        {
            currentTool = t;
            switch (t)
            {
                case Tooltype.None:
                    stopBanner.SetActive(false);
                    break;
                case Tooltype.Draw:
                    stopBanner.SetActive(true);
                    break;
                case Tooltype.Erase:
                    stopBanner.SetActive(true);
                    break;
            }

        }
    }

}